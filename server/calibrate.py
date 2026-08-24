"""
Find the congestion level where the AI twin pulls away from fixed-time.

The demo's argument is a VISIBLE difference between the twins, and that
difference is not monotonic in demand:

  too little traffic   both flow, nothing to see
  too much traffic     both gridlock, nothing to see — measured at 6,602
                       vehicles: 4.40 vs 4.46 km/h, indistinguishable
  the knee             fixed-time collapses while adaptive control still
                       clears its queues. That is the shot the demo needs.

EACH POINT RUNS A FRESH PAIR OF SIMULATIONS. The first version of this swept
scale against one long-running server and produced nonsense — 8,500 vehicles
and 2-3 km/h at every level, because gridlock is ABSORBING. Once the network
has jammed, lowering the insertion rate does nothing: the vehicles already
stuck in it cannot leave. Measuring the knee requires starting clean each time.

    python server/calibrate.py [scale ...]
"""

from __future__ import annotations

import multiprocessing as mp
import queue
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from sim_worker import run_worker

MODES = ("baseline", "ai")
UNTIL = 1500.0     # simulated seconds — long enough for a steady state to form


def _collect(mode, cmd_q, out_q, until, results):
    last = None
    while True:
        try:
            item = out_q.get(timeout=180)
        except queue.Empty:
            break
        if isinstance(item, dict):
            if item.get("type") == "error":
                print(f"\n[{mode}] ERROR\n{item['traceback'][-400:]}")
                break
            continue
        last = item[0]
        if last["metrics"]["sim_time"] >= until:
            break
    cmd_q.put({"type": "stop"})
    results[mode] = last


def run_point(scale: float, until: float) -> dict | None:
    ctx = mp.get_context("spawn")
    cmd_qs, out_qs, procs, results = {}, {}, {}, {}
    for mode in MODES:
        cmd_qs[mode] = ctx.Queue()
        out_qs[mode] = ctx.Queue(maxsize=4)
        p = ctx.Process(target=run_worker, args=(
            mode, cmd_qs[mode], out_qs[mode],
            {"seed": 42, "start_hour": 8.0, "day": "Friday", "end": 999999,
             "speed": 1000.0, "focus": "none", "manual_scale": scale}), daemon=True)
        p.start()
        procs[mode] = p

    threads = [threading.Thread(target=_collect,
                                args=(m, cmd_qs[m], out_qs[m], until, results))
               for m in MODES]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=900)
    for p in procs.values():
        p.join(timeout=8)
        if p.is_alive():
            p.terminate()

    if not results.get("ai") or not results.get("baseline"):
        return None
    return {m: results[m]["metrics"] for m in MODES} | {
        "step_ms": results["ai"]["step_ms"]
    }


def main() -> None:
    scales = [float(a) for a in sys.argv[1:]] or [0.15, 0.25, 0.35, 0.50]
    print(f"fresh simulation pair per point, to t={UNTIL:.0f}s\n")
    print(f"{'scale':>6} {'veh':>6} {'stop%':>6} {'base':>7} {'ai':>7} "
          f"{'gain':>7} {'base tp':>8} {'ai tp':>7} {'step':>6}")
    print("-" * 66)

    rows = []
    for s in scales:
        t0 = time.perf_counter()
        r = run_point(s, UNTIL)
        if not r:
            print(f"{s:>6.2f}   failed")
            continue
        a, b = r["ai"], r["baseline"]
        gain = ((a["mean_speed_kmh"] - b["mean_speed_kmh"]) /
                b["mean_speed_kmh"] * 100) if b["mean_speed_kmh"] else 0
        rows.append((s, a, b, gain))
        print(f"{s:>6.2f} {a['running']:>6} "
              f"{100 * a['halting'] / max(a['running'], 1):>5.0f}% "
              f"{b['mean_speed_kmh']:>7.1f} {a['mean_speed_kmh']:>7.1f} "
              f"{gain:>6.1f}% {b['teleports']:>8} {a['teleports']:>7} "
              f"{r['step_ms']:>6.0f}  ({time.perf_counter() - t0:.0f}s)")

    if not rows:
        return
    print("-" * 66)
    # The best operating point is not simply the biggest percentage gain: it
    # has to be a level where the AI twin is genuinely FLOWING, or the demo
    # shows two jams differing by a rounding error.
    usable = [r for r in rows if r[1]["mean_speed_kmh"] >= 12]
    if usable:
        best = max(usable, key=lambda r: r[3])
        print(f"RECOMMENDED scale {best[0]:.2f} — {best[1]['running']} vehicles, "
              f"fixed-time {best[2]['mean_speed_kmh']:.1f} km/h, "
              f"AI {best[1]['mean_speed_kmh']:.1f} km/h (+{best[3]:.0f}%)")
    else:
        print("No level kept the AI twin above 12 km/h — the network saturates "
              "below the lowest scale tested. Try lower scales.")


if __name__ == "__main__":
    main()
