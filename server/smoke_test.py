"""Run one worker in-process for a few hundred steps and print what comes out."""

import queue
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sim_worker import run_worker

MODE = sys.argv[1] if len(sys.argv) > 1 else "ai"
STEPS = int(sys.argv[2] if len(sys.argv) > 2 else 240)


def main() -> None:
    cmd_q: queue.Queue = queue.Queue()
    out_q: queue.Queue = queue.Queue()

    t = threading.Thread(
        target=run_worker,
        args=(MODE, cmd_q, out_q, {"seed": 42, "start_hour": 7.0, "end": 99999,
                                   "speed": 1000.0, "focus": MODE}),
        daemon=True,
    )
    t0 = time.perf_counter()
    t.start()

    seen = 0
    last = None
    while seen < STEPS:
        try:
            item = out_q.get(timeout=90)
        except queue.Empty:
            print("TIMEOUT waiting for a snapshot")
            break
        if isinstance(item, dict):
            if item.get("type") == "error":
                print("WORKER ERROR:\n", item["traceback"])
                return
            print("msg:", item.get("type"))
            continue
        seen += 1
        snap, veh, sig, cong = item
        last = snap
        if seen % 40 == 0 or seen == 1:
            m = snap["metrics"]
            print(f"[{seen:4d}] t={m['sim_time']:6.0f}s {snap['clock']}  "
                  f"run={m['running']:5d} halt={m['halting']:5d} "
                  f"v={m['mean_speed_kmh']:5.1f}km/h  bus={m['bus_running']:3d}@"
                  f"{m['bus_mean_speed_kmh']:4.1f}  CO2={m['co2_kg']:7.1f}kg  "
                  f"step={snap['step_ms']:5.1f}ms  veh_bytes={len(veh)}")

    cmd_q.put({"type": "stop"})
    dt = time.perf_counter() - t0
    if last:
        print("\n--- final ---")
        print("controller:", last["controller"]["label"], last["controller"]["stats"])
        print("sizes: veh", len(veh), "sig", len(sig), "cong", len(cong))
        print(f"wall {dt:.1f}s for {seen} sim-seconds "
              f"({seen / max(dt, 1e-9):.1f}x realtime, single twin)")


if __name__ == "__main__":
    main()
