"""Where does a simulated second actually go? Times each phase of the loop."""

import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SIM = HERE.parent / "sim"
NET = SIM / "net" / "barcelona.net.xml"

import json
import numpy as np
import libsumo as ls
from libsumo import constants as tc
from controllers import AdaptiveController, build_plans

WARMUP = int(sys.argv[1]) if len(sys.argv) > 1 else 300
SAMPLE = 60

routes = ",".join(str(SIM / "net" / f) for f in ("car.rou.xml", "bike.rou.xml", "bus.rou.xml"))
ls.start(["sumo", "-n", str(NET), "-r", routes, "--step-length", "1", "--seed", "42",
          "--ignore-route-errors", "true", "--time-to-teleport", "240",
          "--no-step-log", "true", "--no-warnings", "true"])

plans = build_plans(ls, list(ls.trafficlight.getIDList()))
ctrl = AdaptiveController(ls, plans)
ctrl_lanes = sorted({l for p in plans.values() for l in p.all_lanes})
for lane in ctrl_lanes:
    ls.lane.subscribe(lane, [tc.LAST_STEP_VEHICLE_HALTING_NUMBER])

data = HERE.parent / "web" / "public" / "data"
roads = json.loads((data / "roads.geojson").read_text(encoding="utf-8"))
edge_ids = [f["properties"]["id"] for f in roads["features"]]
for e in edge_ids:
    ls.edge.subscribe(e, [tc.LAST_STEP_MEAN_SPEED])
sig_ids = [f["properties"]["id"] for f in
           json.loads((data / "signals.geojson").read_text(encoding="utf-8"))["features"]]

VEH_VARS = [tc.VAR_POSITION, tc.VAR_ANGLE, tc.VAR_SPEED,
            tc.VAR_CO2EMISSION, tc.VAR_NOXEMISSION, tc.VAR_FUELCONSUMPTION]

print(f"lanes subscribed: {len(ctrl_lanes):,}   junctions: {len(plans):,}   "
      f"edges: {len(edge_ids):,}   signals: {len(sig_ids):,}")
print(f"warming up {WARMUP} steps ...")
kinds = {}
for _ in range(WARMUP):
    ls.simulationStep()
    for v in ls.simulation.getDepartedIDList():
        ls.vehicle.subscribe(v, VEH_VARS)
        kinds[v] = 1.0 if v.startswith("bus") else 0.0
    for v in ls.simulation.getArrivedIDList():
        kinds.pop(v, None)

acc = {}


def tick(name, t0):
    acc[name] = acc.get(name, 0.0) + (time.perf_counter() - t0)
    return time.perf_counter()


for _ in range(SAMPLE):
    t = time.perf_counter()
    ls.simulationStep()
    t = tick("1 simulationStep", t)

    for v in ls.simulation.getDepartedIDList():
        ls.vehicle.subscribe(v, VEH_VARS)
        kinds[v] = 1.0 if v.startswith("bus") else 0.0
    for v in ls.simulation.getArrivedIDList():
        kinds.pop(v, None)
    t = tick("2 depart/arrive", t)

    res = ls.vehicle.getAllSubscriptionResults()
    n = len(res)
    xy = np.empty((n, 2))
    for i, (vid, d) in enumerate(res.items()):
        p = d[tc.VAR_POSITION]
        xy[i, 0] = p[0]
        xy[i, 1] = p[1]
    t = tick("3 vehicle bulk read", t)

    lane_res = ls.lane.getAllSubscriptionResults()
    halting = {k: v.get(tc.LAST_STEP_VEHICLE_HALTING_NUMBER, 0) for k, v in lane_res.items()}
    t = tick("4 lane halting bulk", t)

    bus_req = {}
    for vid, k in kinds.items():
        if k != 1.0:
            continue
        for tls_id, li, dist, _s in ls.vehicle.getNextTLS(vid)[:1]:
            if dist <= 140:
                bus_req.setdefault(tls_id, []).append(li)
    t = tick("5 bus getNextTLS", t)

    ctrl.step(ls.simulation.getTime(), halting, bus_req)
    t = tick("6 controller.step", t)

    sig = np.zeros(len(sig_ids), dtype=np.uint8)
    for i, tid in enumerate(sig_ids):
        st = ls.trafficlight.getRedYellowGreenState(tid)
        sig[i] = 2 if ("G" in st or "g" in st) else (1 if "y" in st else 0)
    t = tick("7 signal states", t)

    er = ls.edge.getAllSubscriptionResults()
    sp = np.array([er.get(e, {}).get(tc.LAST_STEP_MEAN_SPEED, -1.0) for e in edge_ids],
                  dtype=np.float32)
    t = tick("8 edge congestion", t)

print(f"\nvehicles in sim: {n:,}    (mean ms per simulated second over {SAMPLE} steps)")
print("-" * 52)
total = sum(acc.values())
for k in sorted(acc, key=lambda x: -acc[x]):
    ms = acc[k] / SAMPLE * 1000
    print(f"  {k:<24} {ms:7.2f} ms   {acc[k] / total * 100:5.1f}%")
print("-" * 52)
print(f"  {'TOTAL':<24} {total / SAMPLE * 1000:7.2f} ms")
ls.close()
