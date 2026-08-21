"""
One SUMO simulation, running in its own OS process.

Two of these run at once -- one under fixed-time control, one under the AI
adaptive controller -- from byte-identical network, route files and RNG seed.
Any divergence between them is therefore caused by the signal policy and
nothing else, which is what makes the before/after comparison honest.

We use libsumo rather than socket TraCI: it links SUMO directly into the
process, so the ~15k per-vehicle state reads we do every simulated second cost
microseconds instead of milliseconds. The trade-off is that libsumo allows only
one simulation per process, which is exactly why each twin gets its own process.
"""

from __future__ import annotations

import os
import re
import sys
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
# On Windows multiprocessing uses 'spawn', so the child re-imports this module
# with a fresh interpreter. Make sure it can find controllers.py next to us.
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
SIM = HERE.parent / "sim"
NET = SIM / "net" / "barcelona.net.xml"

KIND_CAR, KIND_BUS, KIND_BIKE = 0.0, 1.0, 2.0


# ---------------------------------------------------------------------------
# Projection: SUMO cartesian -> WGS84, vectorised over all vehicles at once.
# ---------------------------------------------------------------------------
class NetProjection:
    """
    Reads only the <location> header of the .net.xml (a few hundred bytes)
    instead of parsing the whole 30 MB file, then builds one pyproj transformer
    we can apply to a whole numpy array of positions in a single call.
    """

    def __init__(self, net_path: Path):
        head = net_path.open("r", encoding="utf-8").read(8192)
        m = re.search(r"<location\b[^>]*>", head)
        if not m:
            raise RuntimeError("no <location> element found in net file")
        tag = m.group(0)

        def attr(name: str) -> str:
            mm = re.search(rf'{name}="([^"]*)"', tag)
            if not mm:
                raise RuntimeError(f"missing {name} in <location>")
            return mm.group(1)

        ox, oy = (float(v) for v in attr("netOffset").split(","))
        self.offset = (ox, oy)

        import pyproj
        self.proj = pyproj.Proj(attr("projParameter"))

    def to_lonlat(self, xy: np.ndarray) -> np.ndarray:
        """xy: (n,2) float64 in SUMO coords -> (n,2) lon/lat."""
        if len(xy) == 0:
            return xy
        lon, lat = self.proj(
            xy[:, 0] - self.offset[0],
            xy[:, 1] - self.offset[1],
            inverse=True,
        )
        return np.column_stack([lon, lat])


# ---------------------------------------------------------------------------
@dataclass
class Metrics:
    """Running totals. All derived from SUMO state, none of it hand-tuned."""
    sim_time: float = 0.0
    running: int = 0
    arrived: int = 0
    departed: int = 0

    mean_speed: float = 0.0            # m/s, all modes
    halting: int = 0                   # vehicles at a standstill right now

    # integrated over time -> the headline "delay" number
    stopped_veh_seconds: float = 0.0
    bus_stopped_seconds: float = 0.0

    co2_kg: float = 0.0                # from SUMO HBEFA3
    nox_kg: float = 0.0
    fuel_l: float = 0.0

    total_travel_time: float = 0.0     # summed over completed trips
    completed: int = 0

    bus_running: int = 0
    bus_mean_speed: float = 0.0
    bike_running: int = 0

    teleports: int = 0

    # --- equity / tail metrics ---
    # A policy that speeds up the arterial by abandoning a side street would
    # look good on every average above and terrible on these three.
    max_wait_s: float = 0.0     # worst-off vehicle currently in the network
    p95_wait_s: float = 0.0     # 95th percentile of accumulated waiting time
    stranded: int = 0           # vehicles that have waited more than 5 minutes

    def snapshot(self) -> dict:
        avg_trip = (self.total_travel_time / self.completed) if self.completed else 0.0
        return {
            "sim_time": round(self.sim_time, 1),
            "running": self.running,
            "arrived": self.arrived,
            "departed": self.departed,
            "mean_speed_kmh": round(self.mean_speed * 3.6, 2),
            "halting": self.halting,
            "stopped_veh_hours": round(self.stopped_veh_seconds / 3600.0, 3),
            "bus_stopped_hours": round(self.bus_stopped_seconds / 3600.0, 4),
            "co2_kg": round(self.co2_kg, 2),
            "nox_kg": round(self.nox_kg, 4),
            "fuel_l": round(self.fuel_l, 2),
            "avg_trip_time_s": round(avg_trip, 1),
            "completed": self.completed,
            "bus_running": self.bus_running,
            "bus_mean_speed_kmh": round(self.bus_mean_speed * 3.6, 2),
            "bike_running": self.bike_running,
            "teleports": self.teleports,
            "max_wait_s": round(self.max_wait_s, 1),
            "p95_wait_s": round(self.p95_wait_s, 1),
            "stranded": self.stranded,
        }


# ---------------------------------------------------------------------------
def run_worker(mode: str, cmd_q, out_q, cfg: dict) -> None:
    """
    Entry point for the child process.

    mode: "baseline" | "ai"
    cmd_q: commands from the server  (dicts)
    out_q: snapshots back to the server
    """
    try:
        _run(mode, cmd_q, out_q, cfg)
    except Exception:
        out_q.put({"type": "error", "mode": mode, "traceback": traceback.format_exc()})


def _run(mode: str, cmd_q, out_q, cfg: dict) -> None:
    import libsumo as ls
    from libsumo import constants as tc

    from controllers import (AdaptiveController, FixedTimeController,
                             build_plans, clock_string, demand_factor)

    seed = cfg.get("seed", 42)
    start_hour = cfg.get("start_hour", 7.0)

    # ---- boot SUMO -------------------------------------------------------
    # An alternate demand set (built with `build_demand.py --tag _b`) lets the
    # validation harness re-test against genuinely different traffic, not just a
    # different driver-behaviour RNG on the same trips.
    tag = cfg.get("demand_tag", "")
    routes = ",".join(str(SIM / "net" / f"{m}{tag}.rou.xml")
                      for m in ("car", "bike", "bus"))
    ls.start([
        "sumo",
        "-n", str(NET),
        "-r", routes,
        "--step-length", "1",
        "--seed", str(seed),
        "--ignore-route-errors", "true",
        "--time-to-teleport", "240",
        "--max-depart-delay", "600",
        "--collision.action", "teleport",
        "--no-step-log", "true",
        "--no-warnings", "true",
        "--default.emergencydecel", "9",
        "--eager-insert", "true",
        # SUMO only remembers the last 100 s of a vehicle's waiting time by
        # default, so accumulated-wait saturates at 100 and the equity metrics
        # read as an exact 0.0% difference between the twins -- which looks like
        # "no effect" but is really "the instrument is pegged". Widen the window
        # to cover a whole trip.
        "--waiting-time-memory", "3600",
    ])

    proj = NetProjection(NET)

    # ---- signal plans ----------------------------------------------------
    tls_ids = list(ls.trafficlight.getIDList())
    plans = build_plans(ls, tls_ids)

    controller = (
        AdaptiveController(ls, plans, start_hour=start_hour)
        if mode == "ai" else
        FixedTimeController(ls, plans)
    )

    # Queue lengths are read lazily, one lane at a time, only for the junctions
    # the controller actually evaluates this second. Bulk-subscribing all 6,558
    # controlled lanes measured 3x more expensive for data we mostly discard.
    ctrl_lanes = sorted({l for p in plans.values() for l in p.all_lanes})
    _halt_cache: dict[str, int] = {}

    def halt_fn(lane: str) -> int:
        v = _halt_cache.get(lane, -1)
        if v < 0:
            try:
                v = ls.lane.getLastStepHaltingNumber(lane)
            except Exception:
                v = 0
            _halt_cache[lane] = v
        return v

    # Ordered edge list for the congestion overlay, matching roads.geojson.
    import json
    roads = json.loads((HERE.parent / "web" / "public" / "data" / "roads.geojson")
                       .read_text(encoding="utf-8"))
    edge_ids = [f["properties"]["id"] for f in roads["features"]]
    edge_vmax = np.array([max(f["properties"]["vmax"], 1.0) for f in roads["features"]],
                         dtype=np.float32)
    for eid in edge_ids:
        try:
            # Vehicle count as well as speed: an empty edge reports its speed
            # LIMIT as its mean speed, so averaging raw speeds over a corridor
            # mostly measures how many of its edges happen to be empty. The
            # corridor figures below are weighted by vehicles instead.
            ls.edge.subscribe(eid, [tc.LAST_STEP_MEAN_SPEED,
                                    tc.LAST_STEP_VEHICLE_NUMBER])
        except Exception:
            pass
    corridors = json.loads((HERE.parent / "web" / "public" / "data" / "meta.json")
                           .read_text(encoding="utf-8"))["corridors"]

    # Map each named corridor to positions in the edge array, so we can report
    # Diagonal / Gran Via / Meridiana separately. The pitch proposes piloting a
    # single corridor, so a per-corridor number is the one a city would ask for.
    _edge_pos = {e: i for i, e in enumerate(edge_ids)}
    corridor_idx = {
        name: np.array([_edge_pos[e] for e in eids if e in _edge_pos], dtype=np.int32)
        for name, eids in corridors.items()
    }
    corridor_idx = {k: v for k, v in corridor_idx.items() if len(v)}

    # Signal order for the client, matching signals.geojson.
    signals = json.loads((HERE.parent / "web" / "public" / "data" / "signals.geojson")
                         .read_text(encoding="utf-8"))
    sig_ids = [f["properties"]["id"] for f in signals["features"]]

    VEH_VARS = [tc.VAR_POSITION, tc.VAR_ANGLE, tc.VAR_SPEED,
                tc.VAR_CO2EMISSION, tc.VAR_NOXEMISSION, tc.VAR_FUELCONSUMPTION,
                # Accumulated waiting time drives the equity metrics. Any
                # adaptive policy can improve the average by favouring the
                # busiest arm; the honest question is whether it does that by
                # abandoning somebody on a side street. This is how we check.
                tc.VAR_ACCUMULATED_WAITING_TIME]

    metrics = Metrics()
    depart_time: dict[str, float] = {}
    kind_of: dict[str, float] = {}
    running = True
    paused = False
    send_vehicles = (mode == cfg.get("focus", "ai"))
    event_log: list[dict] = []
    pending_events: list[dict] = []
    step_budget = cfg.get("end", 3600)

    def classify(vid: str) -> float:
        if vid.startswith("bus"):
            return KIND_BUS
        if vid.startswith("bike"):
            return KIND_BIKE
        return KIND_CAR

    # ---- event handling --------------------------------------------------
    def apply_event(ev: dict) -> None:
        kind = ev.get("kind")
        now = metrics.sim_time
        try:
            if kind == "rain":
                # Wet asphalt: SUMO's own friction/speed-factor levers. Drivers
                # slow down and keep bigger gaps; some cyclists give up.
                for vt in ls.vehicletype.getIDList():
                    if vt.startswith("car"):
                        ls.vehicletype.setSpeedFactor(vt, 0.78)
                        ls.vehicletype.setTau(vt, 1.6)
                        ls.vehicletype.setDecel(vt, 3.4)
                    elif vt == "bike":
                        ls.vehicletype.setSpeedFactor(vt, 0.72)
                event_log.append({"t": now, "kind": kind, "note":
                                  "speed factor 0.78, headway 1.6 s, bike speed -28%"})

            elif kind == "clear_weather":
                for vt in ls.vehicletype.getIDList():
                    if vt.startswith("car"):
                        ls.vehicletype.setSpeedFactor(vt, 1.0)
                        ls.vehicletype.setTau(vt, 1.1)
                        ls.vehicletype.setDecel(vt, 4.5)
                    elif vt == "bike":
                        ls.vehicletype.setSpeedFactor(vt, 1.0)
                event_log.append({"t": now, "kind": kind, "note": "weather normalised"})

            elif kind in ("concert", "metro_disruption"):
                spec = EVENT_SPECS[kind]
                origins = _edges_near(roads, spec["center"], spec["radius"]) \
                    if "center" in spec else corridors.get(spec["corridor"], [])
                dests = _fringe_edges(roads, spec.get("dest_dir"))
                n = int(spec["vehicles"])
                added = _inject(ls, origins, dests, n, spec["vtypes"],
                                spec["prefix"], now, seed)
                event_log.append({"t": now, "kind": kind,
                                  "note": f"{added} extra car trips injected "
                                          f"over the next 10 minutes"})

            elif kind == "clear_events":
                event_log.clear()
        except Exception as exc:
            event_log.append({"t": now, "kind": kind, "note": f"failed: {exc}"})

    # ---- main loop -------------------------------------------------------
    speed = cfg.get("speed", 5.0)   # sim seconds per wall second
    overlay_tick = 0
    sig_bytes: bytes | None = None
    cong_bytes: bytes = b""
    corridor_stats: dict[str, dict] = {}
    bus_requests: dict[str, list[int]] = {}
    watch_id: str | None = None

    while running:
        # --- drain commands ---
        while not cmd_q.empty():
            c = cmd_q.get()
            t = c.get("type")
            if t == "stop":
                running = False
            elif t == "pause":
                paused = c.get("value", True)
            elif t == "speed":
                speed = max(0.25, min(40.0, float(c.get("value", 5.0))))
            elif t == "focus":
                send_vehicles = (mode == c.get("value"))
            elif t == "watch":
                watch_id = c.get("value") or None
            elif t == "event":
                pending_events.append(c)

        if not running:
            break
        if paused:
            time.sleep(0.05)
            continue

        for ev in pending_events:
            apply_event(ev)
        pending_events.clear()

        # --- advance one simulated second ---
        t_wall = time.perf_counter()
        ls.simulationStep()
        metrics.sim_time = ls.simulation.getTime()
        metrics.teleports += ls.simulation.getStartingTeleportNumber()
        overlay_tick += 1

        # --- track departures / arrivals ---
        for vid in ls.simulation.getDepartedIDList():
            depart_time[vid] = metrics.sim_time
            kind_of[vid] = classify(vid)
            metrics.departed += 1
            try:
                ls.vehicle.subscribe(vid, VEH_VARS)
            except Exception:
                pass
        for vid in ls.simulation.getArrivedIDList():
            d = depart_time.pop(vid, None)
            kind_of.pop(vid, None)
            metrics.arrived += 1
            if d is not None:
                metrics.total_travel_time += metrics.sim_time - d
                metrics.completed += 1

        # --- bulk-read every vehicle in one call ---
        res = ls.vehicle.getAllSubscriptionResults()
        n = len(res)
        metrics.running = n

        if n:
            xy = np.empty((n, 2), dtype=np.float64)
            ang = np.empty(n, dtype=np.float32)
            spd = np.empty(n, dtype=np.float32)
            knd = np.empty(n, dtype=np.float32)
            wait = np.empty(n, dtype=np.float32)
            co2 = 0.0
            nox = 0.0
            fuel = 0.0
            bus_spd_sum = 0.0
            bus_n = 0
            bike_n = 0

            i = 0
            for vid, d in res.items():
                p = d.get(tc.VAR_POSITION, (0.0, 0.0))
                # A vehicle that is mid-teleport (or loaded but not yet placed)
                # reports INVALID_DOUBLE_VALUE as its POSITION. Projecting that
                # yields NaN lon/lat, and a single NaN in the vertex buffer is
                # enough to make deck.gl drop or misdraw the whole layer, so
                # these are excluded from the render set entirely.
                if p[0] < -1e8 or p[1] < -1e8:
                    continue
                xy[i, 0] = p[0]
                xy[i, 1] = p[1]
                a = d.get(tc.VAR_ANGLE, 0.0)
                ang[i] = a if -1e8 < a < 1e8 else 0.0
                s = d.get(tc.VAR_SPEED, 0.0)
                spd[i] = s
                k = kind_of.get(vid, KIND_CAR)
                knd[i] = k
                w = d.get(tc.VAR_ACCUMULATED_WAITING_TIME, 0.0)
                wait[i] = w if 0.0 <= w < 1e8 else 0.0
                i += 1
                # SUMO reports INVALID_DOUBLE_VALUE (-2^30) for a vehicle whose
                # emissions cannot be evaluated this step -- typically while it
                # is on an internal junction lane or mid-teleport. Summing that
                # raw would swing the CO2 total by -1073 kg in a single step.
                e = d.get(tc.VAR_CO2EMISSION, 0.0)
                co2 += e if e > 0.0 else 0.0
                e = d.get(tc.VAR_NOXEMISSION, 0.0)
                nox += e if e > 0.0 else 0.0
                e = d.get(tc.VAR_FUELCONSUMPTION, 0.0)
                fuel += e if e > 0.0 else 0.0
                if k == KIND_BUS:
                    bus_spd_sum += s
                    bus_n += 1
                    if s < 0.1:
                        metrics.bus_stopped_seconds += 1.0
                elif k == KIND_BIKE:
                    bike_n += 1

            # Drop the tail left unused by any skipped vehicles.
            if i < n:
                xy = xy[:i]
                ang = ang[:i]
                spd = spd[:i]
                knd = knd[:i]
                wait = wait[:i]

            # Equity: the tail of the waiting-time distribution, not the mean.
            if len(wait):
                metrics.max_wait_s = float(wait.max())
                metrics.p95_wait_s = float(np.percentile(wait, 95))
                metrics.stranded = int((wait > 300.0).sum())
            else:
                metrics.max_wait_s = metrics.p95_wait_s = 0.0
                metrics.stranded = 0

            # Same sentinel guard for speed, which feeds the halting count.
            np.clip(spd, 0.0, 60.0, out=spd)

            # SUMO reports all three as mg/s; integrated over a 1 s step that is
            # simply mg. Fuel is a MASS in current SUMO (it changed from ml in
            # 1.14), so converting to litres needs a density -- 0.745 kg/l for
            # petrol. Sanity check: this lands within 2% of the litres implied
            # by the CO2 total at 2.31 kg CO2 per litre, which is the right
            # cross-check to run on any emissions figure you plan to show.
            metrics.co2_kg += co2 / 1e6
            metrics.nox_kg += nox / 1e6
            metrics.fuel_l += fuel / 1e6 / 0.745
            metrics.mean_speed = float(spd.mean()) if len(spd) else 0.0
            halt_mask = spd < 0.1
            metrics.halting = int(halt_mask.sum())
            metrics.stopped_veh_seconds += float(halt_mask.sum())
            metrics.bus_running = bus_n
            metrics.bus_mean_speed = (bus_spd_sum / bus_n) if bus_n else 0.0
            metrics.bike_running = bike_n

            lonlat = proj.to_lonlat(xy)
        else:
            lonlat = np.zeros((0, 2))
            ang = spd = knd = np.zeros(0, dtype=np.float32)
            metrics.mean_speed = 0.0
            metrics.halting = 0
            metrics.bus_running = metrics.bike_running = 0

        # --- transit priority requests ---
        # Refreshed every other second: a bus covers at most ~30 m in that time
        # and the detection zone is 140 m, so no bus can slip through unseen.
        if isinstance(controller, AdaptiveController):
            if overlay_tick % 2 == 0:
                bus_requests = {}
                det = controller.bus_detect_m
                for vid, k in kind_of.items():
                    if k != KIND_BUS:
                        continue
                    try:
                        nxt = ls.vehicle.getNextTLS(vid)
                    except Exception:
                        continue
                    for tls_id, link_idx, dist, _state in nxt[:1]:
                        if dist <= det:
                            bus_requests.setdefault(tls_id, []).append(link_idx)

        # --- run the control policy ---
        _halt_cache.clear()
        controller.step(metrics.sim_time, halt_fn, bus_requests)

        # --- signal colours + congestion for the map ---
        # These are pure display data over 1,151 signals and 4,016 edges. At the
        # speeds we run the demo, refreshing them every other simulated second
        # is visually identical and halves the fixed per-step cost.
        if overlay_tick % 2 == 0 or sig_bytes is None:
            sig_state = np.zeros(len(sig_ids), dtype=np.uint8)
            for i, tid in enumerate(sig_ids):
                try:
                    st = ls.trafficlight.getRedYellowGreenState(tid)
                except Exception:
                    continue
                if "G" in st or "g" in st:
                    sig_state[i] = 2
                elif "y" in st or "Y" in st:
                    sig_state[i] = 1
            sig_bytes = sig_state.tobytes()

            edge_res = ls.edge.getAllSubscriptionResults()
            speeds = np.empty(len(edge_ids), dtype=np.float32)
            counts = np.empty(len(edge_ids), dtype=np.float32)
            for j, e in enumerate(edge_ids):
                d = edge_res.get(e)
                if d is None:
                    speeds[j] = -1.0
                    counts[j] = 0.0
                else:
                    speeds[j] = d.get(tc.LAST_STEP_MEAN_SPEED, -1.0)
                    counts[j] = d.get(tc.LAST_STEP_VEHICLE_NUMBER, 0)

            ratio = np.where(speeds < 0, 1.0, np.clip(speeds / edge_vmax, 0.0, 1.0))
            cong_bytes = (ratio * 255).astype(np.uint8).tobytes()

            # Per-corridor figures, weighted by how many vehicles are actually
            # on each edge. An unweighted mean would be dominated by empty
            # edges reporting their speed limit, which reads as "Diagonal is
            # flowing at 46 km/h" during a jam. Weighting answers the question a
            # traffic engineer is actually asking: how fast is the traffic that
            # is out there right now?
            corridor_stats = {}
            for name, idx in corridor_idx.items():
                w = counts[idx]
                total = float(w.sum())
                if total > 0:
                    sp = np.where(speeds[idx] < 0, 0.0, speeds[idx])
                    corridor_stats[name] = {
                        "flow": round(float((ratio[idx] * w).sum() / total), 3),
                        "kmh": round(float((sp * w).sum() / total) * 3.6, 1),
                        "veh": int(total),
                    }
                else:
                    # Nothing on the corridor: free-flowing by definition.
                    corridor_stats[name] = {
                        "flow": 1.0,
                        "kmh": round(float(edge_vmax[idx].mean()) * 3.6, 1),
                        "veh": 0,
                    }

        # --- detail for the junction the user clicked ---
        watch = None
        if watch_id and watch_id in plans:
            plan = plans[watch_id]
            try:
                ph = ls.trafficlight.getPhase(watch_id)
                state = ls.trafficlight.getRedYellowGreenState(watch_id)
                glanes = set(plan.green_lanes[ph]) if ph < len(plan.green_lanes) else set()

                # Aggregate per approach (edge), not per lane. A three-lane arm
                # of Diagonal is one approach a traffic engineer reasons about,
                # not three identical-looking rows.
                by_edge: dict[str, dict] = {}
                served = waiting = 0
                for lane in plan.all_lanes:
                    q = int(ls.lane.getLastStepHaltingNumber(lane))
                    is_g = lane in glanes
                    if is_g:
                        served += q
                    else:
                        waiting += q
                    edge = lane.rsplit("_", 1)[0]
                    row = by_edge.setdefault(
                        edge, {"lane": edge[-18:], "q": 0, "green": False, "lanes": 0})
                    row["q"] += q
                    row["lanes"] += 1
                    row["green"] = row["green"] or bool(is_g)
                rows = sorted(by_edge.values(), key=lambda r: -r["q"])

                # The baseline controller never touches phase_started, so read
                # the phase age from SUMO itself rather than from the plan.
                try:
                    elapsed = round(ls.trafficlight.getSpentDuration(watch_id), 1)
                except Exception:
                    elapsed = round(metrics.sim_time - plan.phase_started, 1)
                watch = {
                    "id": watch_id,
                    "phase": int(ph),
                    "n_phases": plan.n_phases,
                    "state": state[:24],
                    "elapsed": elapsed,
                    "served": int(served),
                    "waiting": int(waiting),
                    "approaches": rows[:6],
                    "reason": controller.explain(watch_id),
                    "tsp_grants": plan.tsp_grants,
                    "early_releases": plan.early_releases,
                    "bus_request": watch_id in bus_requests,
                }
            except Exception:
                watch = None

        # --- emit ---
        snap = {
            "type": "state",
            "mode": mode,
            "clock": clock_string(metrics.sim_time, start_hour),
            "demand_factor": round(demand_factor(metrics.sim_time, start_hour), 3),
            "metrics": metrics.snapshot(),
            "controller": {
                "name": controller.name,
                "label": controller.label,
                "stats": dict(controller.stats),
            },
            "events": event_log[-8:],
            "watch": watch,
            "corridors": corridor_stats,
            "n_veh": int(len(lonlat)),
            "n_sig": len(sig_ids),
            "n_edge": len(edge_ids),
            "has_vehicles": bool(send_vehicles),
            "step_ms": round((time.perf_counter() - t_wall) * 1000, 1),
        }

        if send_vehicles and len(lonlat):
            veh = np.empty((len(lonlat), 5), dtype=np.float32)
            veh[:, 0] = lonlat[:, 0]
            veh[:, 1] = lonlat[:, 1]
            veh[:, 2] = ang
            veh[:, 3] = knd
            veh[:, 4] = spd
            veh_bytes = veh.tobytes()
        else:
            snap["n_veh"] = 0
            veh_bytes = b""

        out_q.put((snap, veh_bytes, sig_bytes, cong_bytes))

        # --- pace to the requested speed multiplier ---
        target = 1.0 / speed
        spent = time.perf_counter() - t_wall
        if spent < target:
            time.sleep(target - spent)

        if metrics.sim_time >= step_budget and ls.simulation.getMinExpectedNumber() <= 0:
            out_q.put({"type": "finished", "mode": mode, "metrics": metrics.snapshot()})
            break

    try:
        ls.close()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Event definitions
# ---------------------------------------------------------------------------
# duarouter expands a <vTypeDistribution> into its member vTypes when it writes
# the route files, so the distribution id "car" does NOT exist at simulation
# time -- only these concrete types do. Injected event traffic samples them with
# the same weights as the distribution, keeping the fleet mix consistent.
CAR_TYPES = ("car_petrol_eu4", "car_petrol_eu6", "car_diesel_eu5", "car_electric")
CAR_WEIGHTS = (0.34, 0.28, 0.24, 0.14)

EVENT_SPECS = {
    # Camp Nou sits inside our extract at roughly 2.1228 E, 41.3809 N.
    "concert": {
        "center": (2.1228, 41.3809),
        "radius": 700.0,
        "vehicles": 900,
        "vtypes": CAR_TYPES,
        "prefix": "evt_concert",
        "dest_dir": None,
    },
    # An L1 metro failure dumps its riders onto the Meridiana road corridor.
    "metro_disruption": {
        "corridor": "meridiana",
        "vehicles": 650,
        "vtypes": CAR_TYPES,
        "prefix": "evt_metro",
        "dest_dir": None,
    },
}


def _edges_near(roads: dict, center: tuple[float, float], radius_m: float) -> list[str]:
    """Edge ids whose first shape point lies within `radius_m` of `center`."""
    lon0, lat0 = center
    mlat = 111_320.0
    mlon = 111_320.0 * np.cos(np.radians(lat0))
    out = []
    for f in roads["features"]:
        lon, lat = f["geometry"]["coordinates"][0]
        d = ((lon - lon0) * mlon) ** 2 + ((lat - lat0) * mlat) ** 2
        if d <= radius_m * radius_m:
            out.append(f["properties"]["id"])
    return out


def _fringe_edges(roads: dict, _dir=None) -> list[str]:
    """Arterial edges, used as plausible destinations for injected traffic."""
    return [f["properties"]["id"] for f in roads["features"]
            if f["properties"]["tier"] == "arterial"]


def _inject(ls, origins: list[str], dests: list[str], n: int,
            vtypes: tuple[str, ...], prefix: str, now: float, seed: int) -> int:
    """
    Add `n` extra trips spread over the next ~10 simulated minutes.

    Routes are computed with SUMO's free-flow router, so given the same net and
    the same seed both twins inject byte-identical traffic. The event is applied
    to the baseline and the AI run alike -- otherwise the comparison would be
    rigged.

    Roughly 1 trip in 10 fails to route: the origin pool is drawn from the
    drawn-road GeoJSON, which includes some links cars may not enter (bus gates,
    contraflow bike links). Those are skipped rather than forced.
    """
    if not origins or not dests:
        return 0
    rng = np.random.default_rng(int(now) * 1000 + seed)
    added = 0
    attempts = 0
    # Keep trying until we place n vehicles, with a hard cap so a pathological
    # origin pool cannot spin here.
    while added < n and attempts < n * 3:
        attempts += 1
        i = attempts
        o = origins[int(rng.integers(len(origins)))]
        d = dests[int(rng.integers(len(dests)))]
        if o == d:
            continue
        vt = vtypes[int(rng.choice(len(vtypes), p=CAR_WEIGHTS))] \
            if len(vtypes) == len(CAR_WEIGHTS) else vtypes[0]
        rid = f"{prefix}_r{int(now)}_{i}"
        vid = f"{prefix}_{int(now)}_{i}"
        try:
            stage = ls.simulation.findRoute(o, d, vt)
            if not stage.edges or len(stage.edges) < 2:
                continue
            ls.route.add(rid, stage.edges)
            ls.vehicle.add(vid, rid, typeID=vt,
                           depart=str(now + float(rng.uniform(1, 600))))
            added += 1
        except Exception:
            continue
    return added
