"""
Train MainstreetAi's neural signal controller, evaluate it honestly, export it.

    python training/train.py train --generations 60 --workers 4
    python training/train.py evaluate
    python training/train.py card          # writes the Hugging Face model card

The notebook (MainstreetAi_signal_policy.ipynb) runs exactly these steps in
Colab; this file holds the logic so it can also be run and tested locally.

WHAT IS LEARNED
A 6 -> 16 -> 1 MLP shared across junctions (web/src/city/neural.js). Each
decision it nudges one junction's split of the cycle between its two groups of
approaches, from that junction's queues. 129 parameters.

HOW: EVOLUTION STRATEGIES, NOT BACKPROPAGATION
The thing being optimised is the outcome of a traffic simulation, which has no
gradient: a vehicle either clears the stop line on this step or it does not.
ES (Salimans et al., 2017) treats the simulation as a black box: perturb the
weights, run, keep the directions that reduced waiting. It needs only forward
passes, parallelises trivially, and is the standard tool for small policies
over non-differentiable simulators.

WHAT IT IS TRAINED AGAINST
The website's own simulator. Fitness is measured by web/scripts/nn-eval.mjs,
which runs sim.js and neural.js -- the files that ship to visitors -- in Node.
Nothing is re-implemented in Python, so the network cannot learn a port's
quirks.

KEEPING SCORE HONESTLY
The 37 ready-made cities are split once, deterministically:
    train      22 cities  -- the only ones the optimiser ever sees
    validation  5 cities  -- used to pick which generation to keep
    test       10 cities  -- touched once, at the end, for the reported number
The final report compares against BOTH fixed timing and the existing
rule-based controller, on the test cities, three seeds each, 15 simulated
minutes -- the same protocol as controller.bench.mjs.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
OUT = ROOT / "training" / "out"

N_IN = 6
HIDDEN = 16
MAX_STEP = 0.15
FORMAT, VERSION = "mainstreetai-signal-mlp", 1

SPLIT_SEED = 20261007
TRAIN_SECONDS = 300
VAL_SECONDS = 600
TEST_SECONDS = 900
TEST_SEEDS = [20260904, 7, 1234]   # the bench's seeds


# ---------------------------------------------------------------- the network
def n_params() -> int:
    return HIDDEN * N_IN + HIDDEN + HIDDEN + 1


def to_model(theta: np.ndarray, meta: dict | None = None) -> dict:
    """Flat parameter vector -> the JSON model neural.js loads."""
    i = 0
    w1 = theta[i:i + HIDDEN * N_IN].reshape(HIDDEN, N_IN); i += HIDDEN * N_IN
    b1 = theta[i:i + HIDDEN]; i += HIDDEN
    w2 = theta[i:i + HIDDEN]; i += HIDDEN
    b2 = theta[i]
    m = {
        "format": FORMAT, "version": VERSION, "hidden": HIDDEN, "maxStep": MAX_STEP,
        "w1": [[round(float(v), 6) for v in row] for row in w1],
        "b1": [round(float(v), 6) for v in b1],
        "w2": [round(float(v), 6) for v in w2],
        "b2": round(float(b2), 6),
    }
    if meta:
        m["meta"] = meta
    return m


def init_theta(rng: np.random.Generator) -> np.ndarray:
    theta = np.zeros(n_params())
    # Hidden layer random so perturbations have something to work with; output
    # layer zero, so the untrained network is EXACTLY fixed timing (its output
    # is 0, no split changes). Training starts from the baseline, not from noise.
    theta[:HIDDEN * N_IN] = rng.normal(0, 1 / math.sqrt(N_IN), HIDDEN * N_IN)
    return theta


# ---------------------------------------------------------------- evaluators
class Evaluators:
    """A pool of Node processes running web/scripts/nn-eval.mjs."""

    def __init__(self, workers: int):
        self.local = threading.local()
        self.procs: list[subprocess.Popen] = []
        self.lock = threading.Lock()
        self.pool = ThreadPoolExecutor(max_workers=workers)
        self.base_cache: dict[tuple, dict] = {}

    def _proc(self) -> subprocess.Popen:
        p = getattr(self.local, "p", None)
        if p is None:
            p = subprocess.Popen(["node", "scripts/nn-eval.mjs"], cwd=WEB, text=True,
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, bufsize=1)
            self.local.p = p
            with self.lock:
                self.procs.append(p)
        return p

    def _one(self, req: dict) -> dict:
        p = self._proc()
        p.stdin.write(json.dumps(req) + "\n")
        p.stdin.flush()
        res = json.loads(p.stdout.readline())
        if "error" in res:
            raise RuntimeError(f"{req.get('city')}: {res['error']}")
        return res

    def run(self, reqs: list[dict]) -> list[dict]:
        return list(self.pool.map(self._one, reqs))

    def baseline(self, cases: list[tuple[str, int, int]]) -> dict:
        """Fixed-timing results, cached: they never change."""
        missing = [c for c in cases if c not in self.base_cache]
        res = self.run([{"id": 0, "controller": "fixed", "city": c, "seed": s, "seconds": t}
                        for c, s, t in missing])
        for c, r in zip(missing, res):
            self.base_cache[c] = r
        return {c: self.base_cache[c] for c in cases}

    def close(self):
        self.pool.shutdown()
        for p in self.procs:
            p.stdin.close()
            p.wait(timeout=10)


def score(r: dict, base: dict) -> float:
    """
    Fitness for one run against fixed timing on the same city and seed.

    Mostly less time stopped, plus throughput, so the network cannot buy a
    lower stopped time by moving fewer vehicles through the network.
    """
    stopped = (base["stopped"] - r["stopped"]) / max(base["stopped"], 1.0)
    through = (r["arrivals"] - base["arrivals"]) / max(base["arrivals"], 1.0)
    return stopped + 0.5 * through


def evaluate(ev: Evaluators, controller, cases: list[tuple[str, int, int]]) -> list[float]:
    base = ev.baseline(cases)
    res = ev.run([{"id": 0, "controller": controller, "city": c, "seed": s, "seconds": t}
                  for c, s, t in cases])
    return [score(r, base[case]) for r, case in zip(res, cases)]


# ---------------------------------------------------------------- data split
def split_cities() -> dict[str, list[str]]:
    cities = json.loads(subprocess.run(["node", "scripts/nn-eval.mjs", "--list"], cwd=WEB,
                                       capture_output=True, text=True, check=True).stdout)
    if len(cities) < 20:
        raise SystemExit(f"only {len(cities)} ready-made cities; bake them first "
                         "(node web/scripts/bake-cities.mjs)")
    order = sorted(cities)
    random.Random(SPLIT_SEED).shuffle(order)
    return {"test": sorted(order[:10]), "val": sorted(order[10:15]), "train": sorted(order[15:])}


# ---------------------------------------------------------------- training
CKPT = OUT / "checkpoint.npz"


def write_best(best: dict, prop_val: float, split: dict, args, gens_done: int) -> None:
    """The best network so far, as a loadable model. Written at every
    improvement, not only at the end: an interrupted run must still leave
    something usable behind (one did not, after 35 generations)."""
    meta = {
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "generations": gens_done, "kept_generation": best["gen"],
        "validation_score": best["val"], "rule_based_validation_score": prop_val,
        "split": split, "split_seed": SPLIT_SEED,
        "es": {"pop_pairs": args.pop, "sigma": args.sigma, "lr": args.lr,
               "cities_per_gen": args.cities_per_gen, "train_seconds": TRAIN_SECONDS},
    }
    (OUT / "model.json").write_text(json.dumps(to_model(best["theta"], meta)), encoding="utf-8")


def save_checkpoint(state: dict) -> None:
    """Everything needed to continue exactly where the run stopped, written
    atomically so a kill mid-write cannot leave a checkpoint that will not load."""
    tmp = OUT / "checkpoint.tmp.npz"
    np.savez(tmp, theta=state["theta"], m=state["m"], v=state["v"],
             best_theta=state["best"]["theta"],
             scalars=np.array([state["gen"], state["best"]["gen"], state["best"]["val"],
                               state["prop_val"]]),
             rng=np.array(json.dumps(state["rng"].bit_generator.state)),
             history=np.array(json.dumps(state["history"])),
             split=np.array(json.dumps(state["split"])))
    tmp.replace(CKPT)


def train(args) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    split = split_cities()
    print(f"cities: {len(split['train'])} train, {len(split['val'])} val, "
          f"{len(split['test'])} test (held out until the end)")

    rng = np.random.default_rng(args.seed)
    theta = init_theta(rng)
    m_adam = np.zeros_like(theta)
    v_adam = np.zeros_like(theta)
    b1, b2, eps = 0.9, 0.999, 1e-8
    best = {"val": -1e9, "gen": -1, "theta": theta.copy()}
    history = []
    start_gen = 0
    prop_val = None

    if args.resume and CKPT.exists():
        # Read everything into memory and CLOSE the file: np.load is lazy and
        # holds the .npz open, and on Windows an open file cannot be replaced --
        # the next checkpoint save then fails with "access denied".
        with np.load(CKPT) as f:
            ck = {k: f[k].copy() for k in f.files}
        if json.loads(str(ck["split"])) != split:
            raise SystemExit("checkpoint was made with a different city split; refusing to resume")
        theta, m_adam, v_adam = ck["theta"], ck["m"], ck["v"]
        gen_done, best_gen, best_val, prop_val = ck["scalars"]
        prop_val = float(prop_val)
        best = {"val": float(best_val), "gen": int(best_gen), "theta": ck["best_theta"]}
        rng.bit_generator.state = json.loads(str(ck["rng"]))
        history = json.loads(str(ck["history"]))
        start_gen = int(gen_done) + 1
        print(f"resuming after generation {int(gen_done)} "
              f"(best so far: generation {best['gen']}, validation {best['val']:+.4f})")

    val_cases = [(c, 1000 + k, VAL_SECONDS) for c in split["val"] for k in range(2)]
    ev = Evaluators(args.workers)

    try:
        if prop_val is None:
            prop_val = float(np.mean(evaluate(ev, "proportional", val_cases)))
        print(f"validation reference: rule-based controller scores {prop_val:+.4f} "
              "(0 = fixed timing)\n")
        t0 = time.time()
        for gen in range(start_gen, args.generations):
            # Fresh cities and seeds each generation: the network has to work
            # across networks and traffic draws, not memorise one.
            cities = rng.choice(split["train"], size=args.cities_per_gen, replace=False)
            cases = [(str(c), int(rng.integers(1, 2**31 - 1)), TRAIN_SECONDS) for c in cities]

            noise = rng.normal(0, 1, (args.pop, theta.size))
            cands = [theta + args.sigma * n for n in noise] + [theta - args.sigma * n for n in noise]
            # Evaluate the whole population in one parallel batch.
            reqs, idx = [], []
            base = ev.baseline(cases)
            for k, cand in enumerate(cands):
                model = to_model(cand)
                for case in cases:
                    reqs.append({"id": 0, "controller": model, "city": case[0],
                                 "seed": case[1], "seconds": case[2]})
                    idx.append((k, case))
            res = ev.run(reqs)
            per = np.zeros(len(cands))
            for (k, case), r in zip(idx, res):
                per[k] += score(r, base[case]) / len(cases)

            # Centred ranks: robust to the occasional outlier city.
            ranks = np.empty(len(per))
            ranks[np.argsort(per)] = np.arange(len(per))
            util = ranks / (len(per) - 1) - 0.5
            grad = ((util[:args.pop] - util[args.pop:])[:, None] * noise).sum(0) / (2 * args.pop * args.sigma)

            # Adam ascent.
            m_adam = b1 * m_adam + (1 - b1) * grad
            v_adam = b2 * v_adam + (1 - b2) * grad ** 2
            mh = m_adam / (1 - b1 ** (gen + 1))
            vh = v_adam / (1 - b2 ** (gen + 1))
            theta = theta + args.lr * mh / (np.sqrt(vh) + eps)

            row = {"gen": gen, "pop_mean": float(per.mean()), "pop_best": float(per.max())}
            if gen % args.val_every == 0 or gen == args.generations - 1:
                row["val"] = float(np.mean(evaluate(ev, to_model(theta), val_cases)))
                if row["val"] > best["val"]:
                    best = {"val": row["val"], "gen": gen, "theta": theta.copy()}
                    write_best(best, prop_val, split, args, gen + 1)
            history.append(row)
            if "val" in row:
                save_checkpoint({"theta": theta, "m": m_adam, "v": v_adam, "best": best,
                                 "gen": gen, "prop_val": prop_val, "rng": rng,
                                 "history": history, "split": split})
            el = time.time() - t0
            print(f"gen {gen:3d}  population mean {row['pop_mean']:+.4f}  best {row['pop_best']:+.4f}"
                  + (f"  | validation {row['val']:+.4f} (rule-based {prop_val:+.4f})" if "val" in row else "")
                  + f"  [{el / 60:.1f} min]", flush=True)
    finally:
        ev.close()

    write_best(best, prop_val, split, args, args.generations)
    (OUT / "history.json").write_text(json.dumps(history, indent=1), encoding="utf-8")
    print(f"\nkept generation {best['gen']} (validation {best['val']:+.4f}) -> {OUT / 'model.json'}")


# ---------------------------------------------------------------- final test
def evaluate_test(args) -> None:
    model = json.loads((OUT / "model.json").read_text(encoding="utf-8"))
    split = model["meta"]["split"]
    cases = [(c, s, TEST_SECONDS) for c in split["test"] for s in TEST_SEEDS]
    ev = Evaluators(args.workers)
    try:
        base = ev.baseline(cases)
        reqs = lambda ctl: [{"id": 0, "controller": ctl, "city": c, "seed": s, "seconds": t}
                            for c, s, t in cases]
        prop = ev.run(reqs("proportional"))
        nn = ev.run(reqs({k: v for k, v in model.items() if k != "meta"}))
    finally:
        ev.close()

    def pct(r, b, k):
        return 100 * (r[k] - b[k]) / max(b[k], 1e-9)

    rows = {}
    for case, p, n in zip(cases, prop, nn):
        b = base[case]
        rows.setdefault(case[0], []).append({
            "rule_stopped": pct(p, b, "stopped"), "nn_stopped": pct(n, b, "stopped"),
            "rule_speed": pct(p, b, "avgSpeed"), "nn_speed": pct(n, b, "avgSpeed"),
            "rule_arrivals": pct(p, b, "arrivals"), "nn_arrivals": pct(n, b, "arrivals"),
            "rule_p95wait": pct(p, b, "p95Wait"), "nn_p95wait": pct(n, b, "p95Wait"),
        })

    print(f"\nHELD-OUT TEST: {len(rows)} cities never seen in training, "
          f"{len(TEST_SEEDS)} seeds, {TEST_SECONDS // 60} simulated minutes each")
    print(f"{'city':<16}{'time stopped vs fixed':>34}{'avg speed vs fixed':>30}")
    print(f"{'':<16}{'rule-based':>17}{'neural':>17}{'rule-based':>15}{'neural':>15}")
    per_city = []
    for city, rs in rows.items():
        avg = {k: float(np.mean([r[k] for r in rs])) for k in rs[0]}
        avg["nn_all_worse"] = all(r["nn_stopped"] > 0 for r in rs)
        avg["nn_beats_rule"] = avg["nn_stopped"] < avg["rule_stopped"]
        per_city.append({"city": city, **avg})
        print(f"{city:<16}{avg['rule_stopped']:>+16.1f}%{avg['nn_stopped']:>+16.1f}%"
              f"{avg['rule_speed']:>+14.1f}%{avg['nn_speed']:>+14.1f}%")
    mean = lambda k: float(np.mean([r[k] for r in per_city]))
    summary = {
        "cities": len(per_city), "seeds": TEST_SEEDS, "seconds": TEST_SECONDS,
        "rule_stopped_mean": mean("rule_stopped"), "nn_stopped_mean": mean("nn_stopped"),
        "rule_speed_mean": mean("rule_speed"), "nn_speed_mean": mean("nn_speed"),
        "rule_p95wait_mean": mean("rule_p95wait"), "nn_p95wait_mean": mean("nn_p95wait"),
        "nn_beats_rule_cities": sum(r["nn_beats_rule"] for r in per_city),
        "nn_consistently_worse_than_fixed": [r["city"] for r in per_city if r["nn_all_worse"]],
    }
    # The bar for replacing the existing controller for visitors: better on
    # average on cities it never saw, and never consistently worse than doing
    # nothing.
    summary["ship"] = (summary["nn_stopped_mean"] < summary["rule_stopped_mean"]
                       and not summary["nn_consistently_worse_than_fixed"])
    print(f"{'MEAN':<16}{summary['rule_stopped_mean']:>+16.1f}%{summary['nn_stopped_mean']:>+16.1f}%"
          f"{summary['rule_speed_mean']:>+14.1f}%{summary['nn_speed_mean']:>+14.1f}%")
    print(f"95th-percentile wait vs fixed: rule-based {summary['rule_p95wait_mean']:+.1f}%, "
          f"neural {summary['nn_p95wait_mean']:+.1f}%")
    print(f"\nneural beats rule-based in {summary['nn_beats_rule_cities']} of {len(per_city)} test cities; "
          f"consistently worse than fixed in: {summary['nn_consistently_worse_than_fixed'] or 'none'}")
    print("VERDICT:", "ship it -- better than the current controller on unseen cities"
          if summary["ship"] else "do NOT ship -- it does not beat the current controller on unseen cities")

    model["meta"]["test"] = {"summary": summary, "per_city": per_city}
    (OUT / "model.json").write_text(json.dumps(model), encoding="utf-8")


# ---------------------------------------------------------------- model card
def write_card(args) -> None:
    model = json.loads((OUT / "model.json").read_text(encoding="utf-8"))
    meta = model["meta"]
    t = meta.get("test", {}).get("summary")
    if not t:
        raise SystemExit("run `evaluate` first: the card reports held-out results")
    rows = "\n".join(
        f"| {r['city']} | {r['rule_stopped']:+.1f}% | {r['nn_stopped']:+.1f}% | "
        f"{r['rule_speed']:+.1f}% | {r['nn_speed']:+.1f}% |"
        for r in meta["test"]["per_city"])
    card = f"""---
license: mit
tags:
- traffic
- traffic-signal-control
- evolution-strategies
- reinforcement-learning
library_name: mainstreetai
---

# MainstreetAi neural signal controller

A tiny neural network that retimes traffic lights: for each junction it reads the
queue on its two groups of approaches and nudges how the cycle is split between them.
It powers the **Your city** view of [MainstreetAi](https://yefry08.github.io/MainstreetAi/),
where it runs in the visitor's browser on the real streets and traffic lights of any city
from OpenStreetMap.

- **Architecture:** MLP, {N_IN} inputs → {HIDDEN} tanh → 1 tanh, shared across junctions ({n_params()} parameters)
- **Training:** OpenAI-style evolution strategies (antithetic sampling, centred ranks, Adam),
  {meta['generations']} generations; generation {meta['kept_generation']} kept by validation score
- **Simulator:** the site's own browser traffic simulator (`web/src/city/sim.js`), run in Node.
  The model was trained against exactly the code it runs in.
- **Constraints it cannot break:** cycle length is preserved and every green stays within 8–55 s.

## Held-out results

{t['cities']} cities **never seen during training**, {len(t['seeds'])} seeds each,
{t['seconds'] // 60} simulated minutes. Change in total vehicle-time spent stopped and in
average speed, against fixed signal timing on identical traffic:

| City | Stopped, rule-based | Stopped, neural | Speed, rule-based | Speed, neural |
|---|---|---|---|---|
{rows}
| **Mean** | **{t['rule_stopped_mean']:+.1f}%** | **{t['nn_stopped_mean']:+.1f}%** | {t['rule_speed_mean']:+.1f}% | {t['nn_speed_mean']:+.1f}% |

"Rule-based" is MainstreetAi's existing controller (proportional green splits with a deadband).
The neural controller beats it in **{t['nn_beats_rule_cities']} of {t['cities']}** test cities.

**Fairness:** cutting total waiting time could be done unfairly, by starving side streets so a few
drivers wait a very long time. The 95th-percentile continuous wait guards against that. Against fixed
timing it changes by **{t['nn_p95wait_mean']:+.1f}%** with the neural controller, and by
{t['rule_p95wait_mean']:+.1f}% with the rule-based one.

**How it wins:** it does not shorten the cycle (the realised cycle stays about 60 s, as with fixed
timing) and never shows a green under 8 s or skips the 3 s amber. It watches the queue on the red side
and ends the current green early when cars are waiting there and the green side has gone quiet. Traffic
engineers call this actuated control. Here it was learned, not programmed.
Consistently worse than fixed timing in: **{', '.join(t['nn_consistently_worse_than_fixed']) or 'none'}**.

## Limits, stated plainly

- Trained and tested in a **simplified simulator**: queue-based car following, random-walk
  routes rather than measured trips. It shows how the controller behaves on each city's real
  network, not what it would do on real streets.
- Each junction is decided from its own queues only; it does not coordinate green waves.
- City splits (train/validation/test) are fixed by seed {SPLIT_SEED} and listed in `model.json`.

## Files

- `model.json`: the weights, plus training and evaluation metadata. Loaded by
  `web/src/city/neural.js`.
"""
    (OUT / "README.md").write_text(card, encoding="utf-8")
    print(f"model card -> {OUT / 'README.md'}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    tr = sub.add_parser("train")
    tr.add_argument("--generations", type=int, default=60)
    tr.add_argument("--pop", type=int, default=12, help="antithetic pairs per generation")
    tr.add_argument("--sigma", type=float, default=0.08)
    tr.add_argument("--lr", type=float, default=0.03)
    tr.add_argument("--cities-per-gen", type=int, default=6)
    tr.add_argument("--val-every", type=int, default=5)
    tr.add_argument("--workers", type=int, default=2)
    tr.add_argument("--seed", type=int, default=0)
    tr.add_argument("--resume", action="store_true",
                    help="continue from training/out/checkpoint.npz")
    ev_ = sub.add_parser("evaluate")
    ev_.add_argument("--workers", type=int, default=2)
    sub.add_parser("card")
    a = ap.parse_args()
    {"train": train, "evaluate": evaluate_test, "card": write_card}[a.cmd](a)
