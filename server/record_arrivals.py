"""
Record training data for the learned forecast: vehicles entering each
signal-controlled lane, per simulated minute, over several seeds.

    MAINSTREET_DISTRICT=santo_domingo python server/record_arrivals.py \
        --seeds 101,102,103,104,105,106 --until 7200 --out sim/arrivals

The runs use the adaptive controller with transit priority and NO forecast:
the arm the learned forecast is added to, so the model learns arrivals as
they look under the controller it will advise. Training seeds must not
overlap the ablation's (42, 7, 1234, 99, 2026), or the ablation would score
the model on traffic it has already seen.

Each seed writes <out>/arrivals_seed<N>.npz: counts (minutes x lanes),
lanes, meta.
"""

from __future__ import annotations

import argparse
import multiprocessing as mp
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from ablation import collect  # noqa: E402

EVAL_SEEDS = {42, 7, 1234, 99, 2026}


def record_one(seed: int, args) -> str:
    from sim_worker import run_worker

    out = Path(args.out) / f"arrivals_seed{seed}.npz"
    ctx = mp.get_context("spawn")
    cmd_q, out_q = ctx.Queue(), ctx.Queue(maxsize=4)
    cfg = {"seed": seed, "start_hour": 7.0, "day": "Friday", "end": 999999,
           "speed": 1000.0, "focus": "none",
           "arms": {"tsp": True, "forecast": False, "learned": False},
           "record_arrivals": str(out.resolve())}
    p = ctx.Process(target=run_worker, args=("ai", cmd_q, out_q, cfg), daemon=True)
    p.start()
    got = collect(out_q, cmd_q, 0.0, args.until) or {}
    # The worker saves the counts after it leaves its loop: give it time.
    p.join(timeout=120)
    if p.is_alive():
        p.terminate()
    if "error" in got:
        return f"FAILED ({got['error'][-200:]})"
    return "ok" if out.exists() else "FAILED (no file written)"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seeds", default="101,102,103,104,105,106")
    ap.add_argument("--until", type=float, default=7200.0)
    ap.add_argument("--parallel", type=int, default=2)
    ap.add_argument("--out", default=str(HERE.parent / "sim" / "arrivals"))
    args = ap.parse_args()
    seeds = [int(s) for s in args.seeds.split(",") if s.strip()]
    clash = EVAL_SEEDS & set(seeds)
    if clash:
        sys.exit(f"seeds {sorted(clash)} are the ablation's evaluation seeds")
    Path(args.out).mkdir(parents=True, exist_ok=True)

    todo = iter(seeds)
    lock = threading.Lock()
    t0 = time.perf_counter()

    def work() -> None:
        while True:
            with lock:
                seed = next(todo, None)
            if seed is None:
                return
            state = record_one(seed, args)
            with lock:
                print(f"seed {seed}: {state}  ({time.perf_counter() - t0:.0f} s)", flush=True)

    threads = [threading.Thread(target=work) for _ in range(max(1, args.parallel))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()


if __name__ == "__main__":
    main()
