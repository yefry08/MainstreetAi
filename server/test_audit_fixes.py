"""
The controller and metrics fixes from the second external audit (2026-11-10).

What was wrong, each pinned here so it cannot come back quietly:

  * the forecast held the green ABOVE transit priority and the fairness cap;
  * the forecast was never loaded at all: a function-level `import json` in
    sim_worker._run made the name local, the load raised UnboundLocalError and
    an `except Exception` swallowed it;
  * the controller did not follow the simulated day, a clock jump, or a start
    hour other than the forecast's own;
  * the fairness cap moved with MAINSTREET_CAPACITY, so a saturation sweep
    changed the policy along with the load;
  * no component could be switched off, so none could be measured;
  * the tail-wait figure was a snapshot of vehicles still in the network.

No SUMO needed: the controller is driven through a stand-in connection.

Run:  python server/test_audit_fixes.py
"""

from __future__ import annotations

import ast
import queue
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import controllers  # noqa: E402
from ablation import collect, paired, summarise, window  # noqa: E402
from controllers import (AdaptiveController, JunctionPlan, POLICY_DEMAND_REF,  # noqa: E402
                         demand_factor, demand_shape)
from sim_worker import (OCCUPANCY, OCCUPANCY_BY_KIND, Metrics,  # noqa: E402
                        latest_common_checkpoint)

failures = 0


def check(name, ok, detail=""):
    global failures
    if not ok:
        failures += 1
    print(f"  {'ok  ' if ok else 'FAIL'} {name}{'   ' + str(detail) if detail else ''}")


# --------------------------------------------------------------------------
# A stand-in for libsumo: one junction, north-south green in phase 0.
# --------------------------------------------------------------------------
class _TL:
    def __init__(self):
        self.phase = 0
        self.sent = []

    def getPhase(self, tid):
        return self.phase

    def setPhaseDuration(self, tid, seconds):
        self.sent.append(seconds)


class _Lane:
    # Both lanes end at the junction (0, 0). ns_0 runs north, ew_0 runs east.
    SHAPES = {"ns_0": [(0.0, -100.0), (0.0, 0.0)], "ew_0": [(-100.0, 0.0), (0.0, 0.0)]}

    def getShape(self, lane):
        return self.SHAPES[lane]


class _Sim:
    def convertGeo(self, lon, lat, fromGeo=True):
        return lon, lat          # the test places things in metres directly


class Conn:
    def __init__(self):
        self.trafficlight, self.lane, self.simulation = _TL(), _Lane(), _Sim()


def plan():
    return JunctionPlan(tls_id="J", is_green=[True, False, True, False],
                        green_lanes=[("ns_0",), (), ("ew_0",), ()],
                        green_links=[frozenset({0}), frozenset(), frozenset({1}), frozenset()],
                        all_lanes=("ew_0", "ns_0"), n_phases=4)


# A school 500 m north of the junction: arrivals use ns_0, which is green.
def wave(begin=0.0, end=3600.0, vph=600.0, lat=500.0, lon=0.0, direction="in"):
    return {"begin": begin, "end": end, "vph": vph, "lat": lat, "lon": lon,
            "dir": direction, "name": "Colegio"}


def controller(forecast=None, **kw):
    c = Conn()
    ctl = AdaptiveController(c, {"J": plan()}, forecast=forecast, **kw)
    return ctl, c


def decide(ctl, conn, queues, buses=None, elapsed=20.0, sim_time=1000.0):
    """One control tick; returns ('hold' | 'release' | None, reason)."""
    p = ctl.plans["J"]
    p.last_phase, p.phase_started = 0, sim_time - elapsed
    ctl._green_until.clear()
    conn.trafficlight.sent.clear()
    ctl.step(sim_time, lambda lane: queues.get(lane, 0), buses or {})
    sent = conn.trafficlight.sent
    act = None if not sent else ("release" if sent[-1] == 0 else "hold")
    return act, ctl.explain("J")


FC = {"J": [wave()]}

print("the forecast only adds to the queues rule 5 compares")
ctl, c = controller(FC)
check("a forecast reaches the controller and maps to the approach heading to the place",
      "J" in ctl.forecast and ctl.forecast["J"][0][3] == frozenset({"ns_0"}), ctl.forecast)
act, why = decide(ctl, c, {"ns_0": 1, "ew_0": 3})
check("it turns a release into a hold when the predicted wave outweighs the queue",
      act == "hold" and why.startswith("forecast:"), why)
check("and that hold is counted as an anticipation", ctl.stats.get("anticipations") == 1)

ctl, c = controller(None)
act, why = decide(ctl, c, {"ns_0": 1, "ew_0": 3})
check("the same queues with no forecast release", act == "release" and "switching" in why, why)

ctl, c = controller(FC)
act, why = decide(ctl, c, {"ns_0": 5, "ew_0": 1})
check("a hold the queues alone would have made is not credited to the forecast",
      act == "hold" and why.startswith("queue") and not ctl.stats.get("anticipations"), why)

print("\nthe forecast cannot override rules 2-4")
ctl, c = controller(FC)
act, why = decide(ctl, c, {"ns_0": 1, "ew_0": 3}, buses={"J": [1]})
check("a bus held at red still gets the green released (rule 2 before the forecast)",
      act == "release" and "transit priority" in why, why)
ctl, c = controller(FC)
act, why = decide(ctl, c, {"ns_0": 1, "ew_0": 3}, elapsed=200.0)
check("the fairness cap still ends the green (rule 4 before the forecast)",
      act == "release" and "max green" in why, why)
ctl, c = controller(FC)
act, why = decide(ctl, c, {"ns_0": 1, "ew_0": 3}, elapsed=3.0)
check("minimum green is still inviolable", act == "hold" and why == "min green", why)

print("\neach component can be switched off")
ctl, c = controller(None, tsp=False)
act, why = decide(ctl, c, {"ns_0": 5, "ew_0": 1}, buses={"J": [1]})
check("tsp off: a waiting bus does not release the green", act == "hold" and why.startswith("queue"), why)
check("tsp off: no priority grants counted", ctl.stats["tsp_grants"] == 0)
check("arms() reports what is on", ctl.arms() == {"tsp": False, "forecast": False}, ctl.arms())
ctl, c = controller(None)
act, why = decide(ctl, c, {"ns_0": 5, "ew_0": 1}, buses={"J": [1]})
check("tsp on (default): the same bus does", act == "release" and "transit priority" in why, why)
ctl, c = controller(FC)
check("full twin reports both on", ctl.arms() == {"tsp": True, "forecast": True}, ctl.arms())

print("\nthe forecast follows the simulated clock")
late = {"J": [wave(begin=3600.0, end=7200.0)]}             # 08:00-09:00 on the forecast's clock
ctl, _ = controller(late)                                   # run starts 07:00, as the forecast does
g, _, _ = ctl._anticipate("J", ("ns_0",), 0.0)
check("07:00 start, t=0: the 08:00 wave is an hour off and silent", g == 0.0, g)
g, _, _ = ctl._anticipate("J", ("ns_0",), 3300.0)
check("07:55: half-way through the 10-minute lead, half the wave", abs(g - 5.0) < 1e-9, g)
g, _, _ = ctl._anticipate("J", ("ns_0",), 3600.0)
check("08:00: the whole wave (600 veh/h over 60 s = 10)", abs(g - 10.0) < 1e-9, g)
ctl, _ = controller(late, start_hour=8.0)                   # a run that STARTS at 08:00
g, _, _ = ctl._anticipate("J", ("ns_0",), 0.0)
check("08:00 start, t=0: the 08:00 wave is on now, not in an hour", abs(g - 10.0) < 1e-9, g)
ctl, _ = controller(late)
ctl.set_clock(start_hour=8.0 - 500.0 / 3600.0)              # the worker's clock jump to 08:00 at t=500
g, _, _ = ctl._anticipate("J", ("ns_0",), 500.0)
check("after a clock jump to 08:00 the wave is on", abs(g - 10.0) < 1e-9, g)
ctl, _ = controller({"J": [wave(begin=300.0, end=900.0)]}, start_hour=6.95)
g, _, _ = ctl._anticipate("J", ("ns_0",), 0.0)              # 06:57, three minutes before 07:00
check("a wave's lead reaches back across the forecast's own start", g > 0.0, g)

print("\nthe time-of-day rule")
old = 55.0 * (0.62 + 0.55 * demand_factor(1000.0, 7.0))     # what step() computed before
new = 55.0 * (0.62 + 0.55 * demand_shape(1000.0, 7.0, "Friday") * POLICY_DEMAND_REF)
if controllers.NETWORK_CAPACITY == 0.5:
    check("is unchanged at the default capacity", abs(old - new) < 1e-9, (old, new))
ctl, c = controller(None)
_, a = decide(ctl, c, {"ns_0": 9, "ew_0": 1}, elapsed=200.0)
keep = controllers.NETWORK_CAPACITY
controllers.NETWORK_CAPACITY = 1.2
try:
    _, b = decide(ctl, c, {"ns_0": 9, "ew_0": 1}, elapsed=200.0)
finally:
    controllers.NETWORK_CAPACITY = keep
check("does not move when the demand scale is swept", a == b and "max green" in a, (a, b))
if controllers.PROFILE and demand_shape(0.0, 8.0, "Sunday") != demand_shape(0.0, 8.0, "Friday"):
    cf, cc = controller(None, start_hour=8.0, day="Friday")
    cs, cd = controller(None, start_hour=8.0, day="Sunday")
    _, rf = decide(cf, cc, {"ns_0": 9, "ew_0": 1}, elapsed=200.0, sim_time=300.0)
    _, rs = decide(cs, cd, {"ns_0": 9, "ew_0": 1}, elapsed=200.0, sim_time=300.0)
    check("follows the simulated day (Sunday is not Friday)", rf != rs, (rf, rs))
    cs.set_clock(day="Friday")
    _, rs2 = decide(cs, cd, {"ns_0": 9, "ew_0": 1}, elapsed=200.0, sim_time=300.0)
    check("and a day change pushed by the worker", rs2 == rf, (rs2, rf))

print("\nthe forecast is actually loaded")
tree = ast.parse((HERE / "sim_worker.py").read_text(encoding="utf-8"))
top = {a.asname or a.name.split(".")[0] for n in tree.body
       if isinstance(n, (ast.Import, ast.ImportFrom)) for a in n.names}
run = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_run")


def own_statements(fn):
    """Statements of fn, not those of the functions nested inside it."""
    todo = list(fn.body)
    while todo:
        n = todo.pop()
        yield n
        if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)):
            todo.extend(ast.iter_child_nodes(n))


shadowed = sorted({a.asname or a.name.split(".")[0] for n in own_statements(run)
                   if isinstance(n, (ast.Import, ast.ImportFrom)) for a in n.names} & top)
check("_run re-imports no module-level name (that makes it local to the whole function, "
      "and every earlier use an UnboundLocalError)", not shadowed, shadowed)

print("\nmetrics")
m = Metrics()
check("no completed trips: percentiles are 0, not an error", m.trip_wait_percentiles() == (0.0, 0.0))
for w in range(1, 101):
    m.note_trip(float(w))
p50, p95 = m.trip_wait_percentiles()
check("median and p95 over completed trips", abs(p50 - 50.5) < 1e-9 and abs(p95 - 95.05) < 1e-9, (p50, p95))
m.loaded, m.departed, m.insertion_backlog = 1000, 900, 60
s = m.snapshot()
check("vehicles dropped before entering = loaded - departed - still waiting", s["not_inserted"] == 40, s["not_inserted"])
m.insertion_backlog = -1
check("-1, not 0, when SUMO does not report the backlog", m.snapshot()["not_inserted"] == -1)
need = {"veh_km", "veh_hours", "bus_km", "bus_hours", "teleporting_veh_seconds", "loaded",
        "insertion_backlog", "insertion_delay_veh_hours", "person_stopped_hours",
        "trip_wait_p50_s", "trip_wait_p95_s", "trip_wait_n"}
check("the snapshot publishes the new figures", need <= set(s), sorted(need - set(s)))
check("occupancy is indexed in wire order (car, bus, bike, truck, moto)",
      list(OCCUPANCY_BY_KIND) == [OCCUPANCY[k] for k in ("car", "bus", "bike", "truck", "moto")])
check("two Metrics do not share one trip list", Metrics().trip_waits is not Metrics().trip_waits)

cp = lambda t, v: {"sim_time": t, "stopped_veh_hours": v}
got = latest_common_checkpoint({"ai": [cp(300, 1), cp(600, 2), cp(900, 3)],
                                "baseline": [cp(300, 5), cp(600, 6)]})
check("twins are compared at the newest second BOTH have reached",
      got and got["sim_time"] == 600 and got["ai"]["stopped_veh_hours"] == 2
      and got["baseline"]["stopped_veh_hours"] == 6, got)
check("none yet when one twin has no checkpoint",
      latest_common_checkpoint({"ai": [cp(300, 1)], "baseline": []}) is None)
check("none when they share no second",
      latest_common_checkpoint({"ai": [cp(900, 1)], "baseline": [cp(300, 1)]}) is None)

print("\nablation")


def snap(t, stopped, km, hours):
    return ({"metrics": {"sim_time": t, "stopped_veh_hours": stopped, "veh_km": km, "veh_hours": hours,
                         "completed": t / 10}, "controller": {"arms": None}}, b"", b"", b"")


q, cmd = queue.Queue(), queue.Queue()
for item in (snap(100, 1.0, 10.0, 1.0), snap(900, 9.0, 300.0, 10.0), snap(901, 9.1, 301.0, 10.1),
             snap(7200, 59.0, 2300.0, 60.0)):
    q.put(item)
got = collect(q, cmd, warmup=900, until=7200, timeout=1)
w = got["window"]
check("the window excludes the warm-up", abs(w["stopped_veh_hours"] - 50.0) < 1e-9 and w["seconds"] == 6300, w)
check("speed is rebuilt from the window's own distance and time", abs(w["avg_speed_kmh"] - 40.0) < 1e-9, w["avg_speed_kmh"])
check("the worker is told to stop", cmd.get_nowait() == {"type": "stop"})
q.put({"type": "error", "traceback": "boom"})
check("a failed worker is reported, not counted", "error" in collect(q, queue.Queue(), 0, 100, timeout=1))
q.put(snap(50, 1, 1, 1))
check("a run that goes quiet before the end is not counted", "error" in collect(q, queue.Queue(), 0, 100, timeout=0.2))

runs = []
for seed, fixed, adaptive in ((1, 100.0, 60.0), (2, 110.0, 64.0), (3, 90.0, 58.0)):
    runs.append({"arm": "fixed", "seed": seed, "window": {"stopped_veh_hours": fixed}})
    runs.append({"arm": "adaptive", "seed": seed, "window": {"stopped_veh_hours": adaptive}})
runs.append({"arm": "adaptive", "seed": 4, "error": "x"})        # a failed run pairs with nothing
p = paired(runs, "adaptive", "fixed", "stopped_veh_hours")
# differences -40, -46, -32: mean -39.33, sd 7.024, t(2) 4.303 -> +/- 17.45
check("paired difference across seeds", p["n"] == 3 and abs(p["mean"] + 39.3333) < 1e-3, p)
check("with its 95% interval (Student t, 2 d.f.)", abs(p["ci95"] - 17.449) < 0.01, p["ci95"])
check("and as a share of the reference", abs(p["pct"] + 39.333) < 0.01, p["pct"])
one = paired(runs[:2], "adaptive", "fixed", "stopped_veh_hours")
check("one seed gives a difference and NO interval", one["n"] == 1 and one["ci95"] is None, one)
check("an arm that was not run gives nothing", paired(runs, "adaptive+tsp", "adaptive", "stopped_veh_hours") is None)
check("a summary covers every step", set(summarise([])) == {"queue-based control", "transit priority",
                                                            "forecast", "ALL (full AI twin)"})

print("\n" + ("all passed" if not failures else f"{failures} FAILED"))
sys.exit(1 if failures else 0)
