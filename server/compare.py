"""
Headless A/B: run both twins to a fixed simulated time and print the delta.

This is the number the pitch stands on, so it is worth being precise about what
makes it a fair test:

  * identical network, identical route files, identical RNG seed
  * identical vehicle insertion order and identical departure times
  * the ONLY difference is which controller touches the signals

Run:  python compare.py [sim_seconds]
"""

import multiprocessing as mp
import queue
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from sim_worker import run_worker

MODES = ("baseline", "ai")


def collect(mode: str, cmd_q, out_q, until: int, results):
    """Reader thread: keep the newest snapshot until the sim passes `until`."""
    last = None
    while True:
        try:
            item = out_q.get(timeout=120)
        except queue.Empty:
            break
        if isinstance(item, dict):
            if item.get("type") == "error":
                print(f"[{mode}] ERROR\n{item['traceback']}")
                break
            continue
        snap = item[0]
        last = snap
        if snap["metrics"]["sim_time"] >= until:
            break
    cmd_q.put({"type": "stop"})
    results[mode] = last


def main() -> None:
    until = int(sys.argv[1]) if len(sys.argv) > 1 else 1200
    ctx = mp.get_context("spawn")
    cmd_qs, out_qs, procs = {}, {}, {}

    print(f"running both twins to t={until}s of simulated time "
          f"(seed 42, identical demand) ...\n")

    for mode in MODES:
        cmd_qs[mode] = ctx.Queue()
        out_qs[mode] = ctx.Queue(maxsize=4)
        p = ctx.Process(target=run_worker, args=(
            mode, cmd_qs[mode], out_qs[mode],
            {"seed": 42, "start_hour": 7.0, "end": 999999,
             "speed": 1000.0, "focus": "none"}), daemon=True)
        p.start()
        procs[mode] = p

    import threading
    results: dict[str, dict] = {}
    threads = [threading.Thread(target=collect,
                                args=(m, cmd_qs[m], out_qs[m], until, results))
               for m in MODES]
    t0 = time.perf_counter()
    for t in threads:
        t.start()

    # progress ticker
    while any(t.is_alive() for t in threads):
        time.sleep(5)
        got = {m: (results.get(m) or {}).get("metrics", {}).get("sim_time", "?")
               for m in MODES}
        elapsed = time.perf_counter() - t0
        print(f"  ... {elapsed:5.0f}s wall", end="\r", flush=True)

    for t in threads:
        t.join(timeout=5)
    for p in procs.values():
        p.join(timeout=5)
        if p.is_alive():
            p.terminate()

    b = results.get("baseline")
    a = results.get("ai")
    if not b or not a:
        print("\nFAILED: missing results", {k: bool(v) for k, v in results.items()})
        return

    bm, am = b["metrics"], a["metrics"]
    print(f"\n\nwall clock: {time.perf_counter() - t0:.0f}s\n")
    print(f"{'metric':<32}{'FIXED-TIME':>14}{'AI-ADAPTIVE':>14}{'change':>12}")
    print("-" * 72)

    def row(label, key, unit="", better="down", scale=1.0):
        vb, va = bm.get(key, 0) * scale, am.get(key, 0) * scale
        if vb == 0:
            pct = "n/a"
        else:
            d = (va - vb) / abs(vb) * 100
            good = (d < 0) if better == "down" else (d > 0)
            pct = f"{d:+.1f}%{'  ok' if good else ''}"
        print(f"{label:<32}{vb:>14,.2f}{va:>14,.2f}{pct:>12}")

    row("vehicles completed", "completed", better="up")
    row("avg trip time (s)", "avg_trip_time_s")
    # Time-integrated speeds (distance / vehicle-seconds), not the
    # instantaneous means. The instantaneous pair is a single-tick sample of
    # two independently seeded twins and swings wildly -- it reported bus
    # speed as +131.9% on the same run where the integrated figure, and four
    # seed-varied runs, agree on about +70%. Quoting the volatile one would
    # flatter the result and would not reproduce.
    row("network speed (km/h)", "avg_speed_kmh", better="up")
    row("vehicles halted (now)", "halting")
    row("stopped-vehicle hours", "stopped_veh_hours")
    row("bus stopped hours", "bus_stopped_hours")
    row("bus speed (km/h)", "bus_avg_speed_kmh", better="up")
    row("CO2 (kg)", "co2_kg")
    row("NOx (kg)", "nox_kg")
    row("fuel (l)", "fuel_l")
    row("teleports (gridlock proxy)", "teleports")
    print("- equity (tail, not average) " + "-" * 43)
    row("worst vehicle wait (s)", "max_wait_s")
    row("p95 vehicle wait (s)", "p95_wait_s")
    row("waited over 5 min", "stranded")
    print("-" * 72)

    # Per-corridor flow index: mean (speed / speed limit) over the corridor's
    # edges. This is the number a pilot proposal would be judged on, because a
    # pilot instruments one corridor, not a city.
    cb, ca = b.get("corridors") or {}, a.get("corridors") or {}
    if ca:
        print(f"\n{'corridor flow index':<32}{'FIXED-TIME':>14}{'AI-ADAPTIVE':>14}{'change':>12}")
        print("-" * 72)
        for name in sorted(ca):
            vb = (cb.get(name) or {}).get("flow", 0.0)
            va = (ca.get(name) or {}).get("flow", 0.0)
            pct = ((va - vb) / abs(vb) * 100) if vb else 0.0
            print(f"{name.replace('_', ' '):<32}{vb:>14.3f}{va:>14.3f}"
                  f"{pct:>+11.1f}%")
        print("-" * 72)

    print("AI controller activity:", a["controller"]["stats"])
    print("\nNote: both runs are the same synthetic demand on the real OSM "
          "network. Percentages are simulation results, not field measurements.")


if __name__ == "__main__":
    main()
