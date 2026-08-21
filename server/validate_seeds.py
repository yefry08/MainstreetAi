"""
Repeat the A/B across several random seeds and report the spread.

A single paired run tells you the AI beat fixed-time once. It does not tell you
whether that was the policy or the seed. This runs the whole twin experiment N
times with different SUMO seeds and prints, for each metric, the mean change and
the worst case across seeds.

The claim we actually want to be able to defend is the worst case: "on every
seed we tried, delay went down by at least X%."

Run:  python validate_seeds.py [sim_seconds] [n_seeds]
Takes roughly (sim_seconds / 7) seconds of wall clock per seed on 4 cores.
"""

import multiprocessing as mp
import queue
import statistics
import sys
import threading
import time
from pathlib import Path  # noqa: F401  (used for the demand-set check)

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from sim_worker import run_worker

MODES = ("baseline", "ai")

# (label, metric key, direction that counts as an improvement)
METRICS = [
    ("stopped-vehicle hours", "stopped_veh_hours", "down"),
    ("avg trip time", "avg_trip_time_s", "down"),
    ("network speed", "mean_speed_kmh", "up"),
    ("bus stopped hours", "bus_stopped_hours", "down"),
    ("bus mean speed", "bus_mean_speed_kmh", "up"),
    ("trips completed", "completed", "up"),
    ("CO2", "co2_kg", "down"),
    ("NOx", "nox_kg", "down"),
    ("teleports", "teleports", "down"),
    ("p95 wait", "p95_wait_s", "down"),
    ("worst wait", "max_wait_s", "down"),
    ("waiting >5 min", "stranded", "down"),
]


def _collect(mode, cmd_q, out_q, until, results):
    last = None
    while True:
        try:
            item = out_q.get(timeout=180)
        except queue.Empty:
            break
        if isinstance(item, dict):
            if item.get("type") == "error":
                print(f"\n[{mode}] ERROR\n{item['traceback']}")
                break
            continue
        last = item[0]
        if last["metrics"]["sim_time"] >= until:
            break
    cmd_q.put({"type": "stop"})
    results[mode] = last


def run_pair(seed: int, until: int, demand_tag: str = "") -> dict | None:
    """One paired baseline/AI run at a given seed and demand set."""
    ctx = mp.get_context("spawn")
    cmd_qs, out_qs, procs, results = {}, {}, {}, {}

    for mode in MODES:
        cmd_qs[mode] = ctx.Queue()
        out_qs[mode] = ctx.Queue(maxsize=4)
        p = ctx.Process(target=run_worker, args=(
            mode, cmd_qs[mode], out_qs[mode],
            {"seed": seed, "start_hour": 7.0, "end": 999999,
             "speed": 1000.0, "focus": "none",
             "demand_tag": demand_tag}), daemon=True)
        p.start()
        procs[mode] = p

    threads = [threading.Thread(target=_collect,
                                args=(m, cmd_qs[m], out_qs[m], until, results))
               for m in MODES]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=until * 2 + 300)
    for p in procs.values():
        p.join(timeout=8)
        if p.is_alive():
            p.terminate()

    if not results.get("baseline") or not results.get("ai"):
        return None
    return {
        "baseline": results["baseline"]["metrics"],
        "ai": results["ai"]["metrics"],
        "stats": results["ai"]["controller"]["stats"],
    }


def main() -> None:
    until = int(sys.argv[1]) if len(sys.argv) > 1 else 1200
    n_runs = int(sys.argv[2]) if len(sys.argv) > 2 else 4

    # Two axes of variation, which are NOT equivalent:
    #   seed        changes SUMO's driver-behaviour RNG on the same trips
    #   demand_tag  changes the trips themselves (a separately generated set)
    # Varying only the seed would be the weaker claim, so we do both. The
    # tagged demand sets must exist: build them with
    #   python sim/build_demand.py --seed 909 --tag _b
    net = Path(__file__).resolve().parent.parent / "sim" / "net"
    have_b = (net / "car_b.rou.xml").exists()

    plan = [(42, ""), (1337, "")]
    if have_b:
        plan += [(42, "_b"), (2026, "_b")]
    else:
        plan += [(2026, ""), (7, "")]
        print("!! alternate demand set (car_b.rou.xml) not found -- varying the")
        print("   SUMO seed only. Build it for a stronger result:")
        print("   python sim/build_demand.py --end 3600 --seed 909 --tag _b\n")
    plan = plan[:n_runs]

    print(f"validating across {len(plan)} runs, {until}s of simulated time each")
    for s, t in plan:
        print(f"   seed {s:<6} demand {'A' if not t else 'B'}")
    print()

    runs = []
    t0 = time.perf_counter()
    for i, (seed, dtag) in enumerate(plan, 1):
        label = f"seed {seed} / demand {'A' if not dtag else 'B'}"
        print(f"  [{i}/{len(plan)}] {label} ... ", end="", flush=True)
        ts = time.perf_counter()
        r = run_pair(seed, until, dtag)
        if r is None:
            print("FAILED")
            continue
        runs.append((label, r))
        d = r["ai"]["stopped_veh_hours"] - r["baseline"]["stopped_veh_hours"]
        pct = d / max(r["baseline"]["stopped_veh_hours"], 1e-9) * 100
        print(f"done in {time.perf_counter() - ts:5.0f}s   delay {pct:+.1f}%")

    if not runs:
        print("\nNo successful runs.")
        return

    print(f"\nwall clock: {time.perf_counter() - t0:.0f}s over {len(runs)} runs\n")
    print(f"{'metric':<24}{'mean Δ':>10}{'best':>9}{'worst':>9}   verdict")
    print("-" * 72)

    for label, key, better in METRICS:
        deltas = []
        for _label, r in runs:
            b, a = r["baseline"].get(key, 0), r["ai"].get(key, 0)
            if not b:
                continue
            deltas.append((a - b) / abs(b) * 100)
        if not deltas:
            continue

        mean = statistics.fmean(deltas)
        if better == "down":
            best, worst = min(deltas), max(deltas)
            ok = worst < 0
        else:
            best, worst = max(deltas), min(deltas)
            ok = worst > 0

        verdict = "improved on every run" if ok else "MIXED"
        print(f"{label:<24}{mean:>+9.1f}%{best:>+8.1f}%{worst:>+8.1f}%   {verdict}")

    print("-" * 72)
    print("'worst' is the least favourable result across runs -- that is the"
          "\nnumber worth quoting, not the mean. Runs vary both SUMO's"
          "\ndriver-behaviour seed and, where the tagged set exists, the"
          "\nunderlying trip demand itself.")


if __name__ == "__main__":
    main()
