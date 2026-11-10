"""
What is each part of the adaptive controller worth?

The AI twin is three things switched on together: queue-based control, transit
priority (TSP) and the forecast of predicted waves. One before/after number
cannot say which of them earned it. This runs the same demand four ways,

    fixed                    the fixed-time plan
    adaptive                 queue-based control only
    adaptive+tsp             ... plus transit priority
    adaptive+tsp+forecast    ... plus the forecast (the full AI twin)

on several seeds, and reports each STEP as a paired difference with a 95%
confidence interval: adaptive against fixed, TSP against adaptive, the forecast
against TSP. Every arm of a seed runs identical network, routes and RNG seed,
so a step's difference is that component and nothing else.

Figures are taken over a measurement WINDOW, from --warmup to --until, by
subtracting two snapshots of the same run: the network starts empty, and its
first minutes flatter whichever controller is being measured.

    python server/ablation.py --until 7200 --warmup 900 --seeds 42,7,1234,99,2026

    --scale 0.8      hold demand at this scale instead of following the hourly
                     curve; repeat at several scales for a saturation sweep
    --parallel 2     runs at once (each is a whole SUMO: mind the RAM)
    --out FILE       every run's figures, as JSON, for analysis elsewhere

Wall clock: roughly (until / 7) seconds per run on 4 cores, four runs a seed.
"""

from __future__ import annotations

import argparse
import json
import math
import multiprocessing as mp
import queue
import statistics
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

# (label, worker mode, arms for the adaptive controller)
ARMS = [
    ("fixed", "baseline", None),
    ("adaptive", "ai", {"tsp": False, "forecast": False}),
    ("adaptive+tsp", "ai", {"tsp": True, "forecast": False}),
    ("adaptive+tsp+forecast", "ai", {"tsp": True, "forecast": True}),
]
# Each step isolates one component: (what it measures, arm, the arm before it).
STEPS = [
    ("queue-based control", "adaptive", "fixed"),
    ("transit priority", "adaptive+tsp", "adaptive"),
    ("forecast", "adaptive+tsp+forecast", "adaptive+tsp"),
    ("ALL (full AI twin)", "adaptive+tsp+forecast", "fixed"),
]

# Totals that accrue with time: a window is the difference of two snapshots.
CUMULATIVE = [
    "stopped_veh_hours", "bus_stopped_hours", "person_stopped_hours", "co2_kg", "nox_kg",
    "fuel_l", "completed", "departed", "arrived", "loaded", "teleports",
    "teleporting_veh_seconds", "insertion_delay_veh_hours", "veh_km", "veh_hours",
    "bus_km", "bus_hours",
]
# (label, key in the window, direction that counts as an improvement)
REPORT = [
    ("stopped veh-hours", "stopped_veh_hours", "down"),
    ("person-hours stopped", "person_stopped_hours", "down"),
    ("insertion delay veh-h", "insertion_delay_veh_hours", "down"),
    ("network speed km/h", "avg_speed_kmh", "up"),
    ("bus speed km/h", "bus_avg_speed_kmh", "up"),
    ("trips completed", "completed", "up"),
    ("CO2 kg", "co2_kg", "down"),
    ("teleports", "teleports", "down"),
]

# Two-sided 95% Student t, by degrees of freedom (no scipy in this environment).
_T95 = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306,
        9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131,
        16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086, 25: 2.060, 30: 2.042}


def t95(df: int) -> float:
    if df <= 0:
        return float("nan")
    if df in _T95:
        return _T95[df]
    return _T95[max(k for k in _T95 if k <= df)] if df < 30 else 1.96 + 2.4 / df


def window(start: dict | None, end: dict) -> dict:
    """
    One run's figures over the measurement window: `end` minus `start` for
    everything cumulative, and the two speeds rebuilt from the windowed
    distance and time. `start` None means no warm-up was taken.
    """
    s = start or {}
    w = {k: end.get(k, 0) - s.get(k, 0) for k in CUMULATIVE}
    w["avg_speed_kmh"] = w["veh_km"] / w["veh_hours"] if w["veh_hours"] > 0 else 0.0
    w["bus_avg_speed_kmh"] = w["bus_km"] / w["bus_hours"] if w["bus_hours"] > 0 else 0.0
    w["seconds"] = end.get("sim_time", 0) - s.get("sim_time", 0)
    # State at the end of the window, not totals: reported as they stand.
    for k in ("insertion_backlog", "not_inserted", "running", "halting", "p95_wait_s",
              "trip_wait_p50_s", "trip_wait_p95_s", "trip_wait_n"):
        w[k] = end.get(k)
    return w


def collect(out_q, cmd_q, warmup: float, until: float, timeout: float = 300.0) -> dict | None:
    """
    Read one worker's snapshots: keep the one at the end of the warm-up and the
    one at `until`, then stop the worker. None if it failed or went quiet.
    """
    at_warmup = last = None
    error = None
    while True:
        try:
            item = out_q.get(timeout=timeout)
        except queue.Empty:
            error = f"no snapshot for {timeout:.0f} s"
            break
        if isinstance(item, dict):
            if item.get("type") == "error":
                error = item.get("traceback", "worker error")
                break
            if item.get("type") == "finished":
                break
            continue
        last = item[0]
        t = last["metrics"]["sim_time"]
        if at_warmup is None and warmup > 0 and t >= warmup:
            at_warmup = last["metrics"]
        if t >= until:
            break
    cmd_q.put({"type": "stop"})
    if error or last is None or last["metrics"]["sim_time"] < until:
        return {"error": error or "stopped before the end of the window"}
    return {"window": window(at_warmup, last["metrics"]), "end": last["metrics"],
            "controller": last.get("controller")}


def run_one(label: str, mode: str, arms: dict | None, seed: int, args) -> dict:
    from sim_worker import run_worker

    ctx = mp.get_context("spawn")
    cmd_q, out_q = ctx.Queue(), ctx.Queue(maxsize=4)
    cfg = {"seed": seed, "start_hour": args.start_hour, "day": args.day, "end": 999999,
           "speed": 1000.0, "focus": "none", "demand_tag": args.demand_tag}
    if arms is not None:
        cfg["arms"] = arms
    if args.scale is not None:
        cfg["manual_scale"] = args.scale
    p = ctx.Process(target=run_worker, args=(mode, cmd_q, out_q, cfg), daemon=True)
    p.start()
    got = collect(out_q, cmd_q, args.warmup, args.until) or {}
    p.join(timeout=8)
    if p.is_alive():
        p.terminate()
    return {"arm": label, "seed": seed, **got}


def paired(runs: list[dict], arm: str, ref: str, key: str) -> dict | None:
    """Per-seed difference arm - ref for one figure: mean, 95% CI, % of ref."""
    by = {(r["arm"], r["seed"]): r["window"] for r in runs if "window" in r}
    seeds = sorted({s for a, s in by if a == arm} & {s for a, s in by if a == ref})
    if not seeds:
        return None
    d = [by[(arm, s)][key] - by[(ref, s)][key] for s in seeds]
    base = statistics.fmean(by[(ref, s)][key] for s in seeds)
    mean = statistics.fmean(d)
    # None, not NaN, where a figure does not exist (one seed has no interval):
    # the output file has to stay valid JSON for whatever reads it next.
    half = (t95(len(d) - 1) * statistics.stdev(d) / math.sqrt(len(d))) if len(d) > 1 else None
    return {"n": len(d), "mean": mean, "ci95": half, "ref_mean": base,
            "pct": (100.0 * mean / base) if base else None,
            "pct_ci95": (100.0 * half / abs(base)) if base and half is not None else None}


def summarise(runs: list[dict]) -> dict:
    return {what: {key: paired(runs, arm, ref, key) for _, key, _ in REPORT}
            for what, arm, ref in STEPS}


def print_summary(runs: list[dict]) -> None:
    ok = [r for r in runs if "window" in r]
    print(f"\n{'arm':<24}" + "".join(f"{lab[:17]:>19}" for lab, _, _ in REPORT[:5]))
    print("-" * (24 + 19 * 5))
    for label, _, _ in ARMS:
        rs = [r["window"] for r in ok if r["arm"] == label]
        if rs:
            print(f"{label:<24}" + "".join(
                f"{statistics.fmean(r[k] for r in rs):>19,.2f}" for _, k, _ in REPORT[:5])
                + f"   (n={len(rs)})")
    for what, by_key in summarise(runs).items():
        print(f"\nSTEP: {what}  -- paired difference, mean and 95% CI across seeds")
        for label, key, better in REPORT:
            s = by_key[key]
            if not s:
                continue
            good = (s["mean"] < 0) if better == "down" else (s["mean"] > 0)
            # A step counts only when its interval excludes zero.
            clear = s["ci95"] is not None and abs(s["mean"]) > s["ci95"]
            verdict = (("better" if good else "WORSE") if clear else
                       "one seed: no interval" if s["ci95"] is None else
                       "not distinguishable from 0")
            num = lambda v, f: format(v, f) if v is not None else "n/a"
            print(f"  {label:<24}{s['mean']:>+12.2f} +/- {num(s['ci95'], '.2f'):<9}"
                  f"{num(s['pct'], '+.1f'):>8}% +/- {num(s['pct_ci95'], '.1f'):<6}  {verdict}")
    bad = [r for r in runs if "window" not in r]
    for r in bad:
        print(f"\nFAILED  {r['arm']} seed {r['seed']}: {str(r.get('error'))[-300:]}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--until", type=float, default=7200.0, help="end of the window, simulated s")
    ap.add_argument("--warmup", type=float, default=900.0, help="start of the window, simulated s")
    ap.add_argument("--seeds", default="42,7,1234,99,2026")
    ap.add_argument("--scale", type=float, default=None)
    ap.add_argument("--start-hour", dest="start_hour", type=float, default=7.0)
    ap.add_argument("--day", default="Friday")
    ap.add_argument("--demand-tag", dest="demand_tag", default=None)
    ap.add_argument("--parallel", type=int, default=2)
    ap.add_argument("--out", default="ablation.json")
    args = ap.parse_args()
    if args.demand_tag is None:
        from sim_worker import DEMAND_TAG
        args.demand_tag = DEMAND_TAG
    if args.warmup >= args.until:
        sys.exit("--warmup must be before --until")
    seeds = [int(s) for s in args.seeds.split(",") if s.strip()]

    jobs = [(label, mode, arms, seed) for seed in seeds for label, mode, arms in ARMS]
    runs: list[dict] = []
    lock = threading.Lock()
    todo = iter(jobs)
    t0 = time.perf_counter()

    def work() -> None:
        while True:
            with lock:
                job = next(todo, None)
            if job is None:
                return
            r = run_one(*job, args)
            with lock:
                runs.append(r)
                state = "ok" if "window" in r else "FAILED"
                print(f"[{len(runs)}/{len(jobs)}] seed {r['seed']} {r['arm']:<24}{state}"
                      f"  ({time.perf_counter() - t0:.0f} s)", flush=True)
                # Written after every run: a long sweep that dies keeps what it had.
                Path(args.out).write_text(json.dumps(
                    {"config": vars(args), "arms": [a[0] for a in ARMS], "runs": runs,
                     "summary": summarise(runs)}, indent=1), encoding="utf-8")

    threads = [threading.Thread(target=work) for _ in range(max(1, args.parallel))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    print_summary(runs)
    print(f"\nwritten {args.out}")
    print("Same synthetic demand on the real OSM network in every arm: simulation "
          "results, not field measurements.")


if __name__ == "__main__":
    main()
