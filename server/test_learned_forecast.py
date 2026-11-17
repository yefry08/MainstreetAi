"""
The learned arrivals forecast: how it counts, what it feeds the controller,
and that it cannot override the rules above it.

No SUMO needed: the controller is driven through a stand-in connection.

Run:  python server/test_learned_forecast.py
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from controllers import AdaptiveController, JunctionPlan  # noqa: E402
from learned_forecast import BIN_S, ArrivalCounter, Predictor, features  # noqa: E402

failures = 0


def check(name, ok, detail=""):
    global failures
    if not ok:
        failures += 1
    tail = "" if isinstance(detail, str) and not detail else f"   {detail}"
    print(f"  {'ok  ' if ok else 'FAIL'} {name}{tail}")


print("the counter counts vehicles entering a controlled lane, once each")
c = ArrivalCounter(["a_0", "b_0"])
for t in range(1, 61):
    c.see("v1", "a_0")           # stays on a_0 for a minute: one entry
    c.see("v2", "x_0" if t < 30 else "b_0")   # enters b_0 from an uncounted lane
    c.see("v3", ":J_0_0")        # on a junction's internal lane: never counted
    c.tick(float(t))
h = c.history()
check("one closed minute after 60 s", h.shape == (1, 2), h.shape)
check("a vehicle that stays on its lane is counted once", h[0, 0] == 1.0, h)
check("a vehicle entering from an uncounted lane is counted", h[0, 1] == 1.0, h)
c.forget("v1")
c.see("v1", "a_0")
c.tick(120.0)
check("a forgotten vehicle seen again counts as a new entry", c.history()[1, 0] == 1.0, c.history())
c.tick(300.0)
check("quiet minutes still close, as zeros", c.history().shape[0] == 5 and c.history()[2:].sum() == 0)

print("\nfeatures read only the past")
hist = np.arange(20, dtype=np.float32).reshape(10, 2)
typ = np.ones((10, 2), np.float32)
x = features(hist, 5, typ, np.ones(2, np.float32))
check("lag1 is the minute before", x[0, 0] == hist[4, 0], x[0, :3])
check("nothing from minute t or later", x[:, :10].max() <= hist[4].max(), x[:, :10].max())

print("\nthe predictor aligns lanes and waits for history")
with tempfile.TemporaryDirectory() as d:
    d = Path(d)
    np.savez_compressed(d / "profile.npz", typical=np.full((5, 2), 3.0, np.float32),
                        lane_mean=np.array([3.0, 3.0], np.float32), lanes=np.array(["a_0", "b_0"]))
    (d / "model.json").write_text(json.dumps({"kind": "profile"}))
    p = Predictor(d, ["b_0", "new_0"])
    check("a lane the model never saw is reported as uncovered", p.coverage == 0.5, p.coverage)
    cc = ArrivalCounter(["b_0", "new_0"])
    check("no prediction before MIN_HISTORY minutes", p.predict(cc) is None)
    cc.rows = [np.zeros(2, np.float32)] * 3
    pr = p.predict(cc)
    check("the known lane gets its profile, the unknown one zero", list(pr) == [3.0, 0.0], pr)


print("\nthe controller uses it only as extra queue for rule 5")
class _TL:
    def __init__(self):
        self.phase, self.sent = 0, []

    def getPhase(self, tid):
        return self.phase

    def setPhaseDuration(self, tid, s):
        self.sent.append(s)


class Conn:
    def __init__(self):
        self.trafficlight = _TL()


def ctl():
    plan = JunctionPlan(tls_id="J", is_green=[True, False, True, False],
                        green_lanes=[("ns_0",), (), ("ew_0",), ()],
                        green_links=[frozenset({0}), frozenset(), frozenset({1}), frozenset()],
                        all_lanes=("ew_0", "ns_0"), n_phases=4)
    c = Conn()
    return AdaptiveController(c, {"J": plan}), c


def decide(a, c, queues, lf=None, buses=None, elapsed=20.0):
    p = a.plans["J"]
    p.last_phase, p.phase_started = 0, 1000.0 - elapsed
    a._green_until.clear()
    a.lane_forecast = lf
    c.trafficlight.sent.clear()
    a.step(1000.0, lambda l: queues.get(l, 0), buses or {})
    s = c.trafficlight.sent
    return (None if not s else ("release" if s[-1] == 0 else "hold")), a.explain("J")


a, c = ctl()
act, why = decide(a, c, {"ns_0": 1, "ew_0": 3})
check("no forecast: the heavier red side gets the green", act == "release", why)
a, c = ctl()
act, why = decide(a, c, {"ns_0": 1, "ew_0": 3}, lf={"ns_0": 6.0})
check("predicted arrivals on the green approach turn it into a hold",
      act == "hold" and "learned" in why, why)
check("and the hold is counted as one the forecast caused", a.stats.get("anticipations") == 1)
a, c = ctl()
act, why = decide(a, c, {"ns_0": 3, "ew_0": 1}, lf={"ew_0": 9.0})
check("predicted arrivals on the red approach turn a hold into a release", act == "release", why)
a, c = ctl()
act, why = decide(a, c, {"ns_0": 1, "ew_0": 3}, lf={"ns_0": 6.0}, buses={"J": [1]})
check("a bus held at red still wins (rule 2 before the forecast)",
      act == "release" and "transit" in why, why)
a, c = ctl()
act, why = decide(a, c, {"ns_0": 1, "ew_0": 3}, lf={"ns_0": 6.0}, elapsed=200.0)
check("the fairness cap still ends the green (rule 4)", act == "release" and "max green" in why, why)
a, c = ctl()
a.learned_on = True
check("arms() reports the learned forecast as on", a.arms()["learned"] is True, a.arms())
check("the minute bin is one minute", BIN_S == 60.0)

print(f"\n{'all passed' if not failures else f'{failures} FAILED'}")
sys.exit(1 if failures else 0)
