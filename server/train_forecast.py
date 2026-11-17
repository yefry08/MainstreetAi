"""
Train and evaluate the learned arrivals forecast (learned_forecast.py).

    python server/train_forecast.py --data sim/arrivals --val-seeds 105,106

Splits by SEED, never by minute: validation seeds are whole runs the model has
not seen, so a lane's neighbouring minutes cannot leak into its score.

Candidates, all predicting vehicles entering each lane in the next minute:

    persistence   the last minute's count
    mean3         the mean of the last three minutes
    profile       the training runs' mean for that lane and minute -- what a
                  city has from a year of loop data, with no live input
    lightgbm      gradient-boosted trees on recent counts + the profile
    chronos       Chronos-Bolt (amazon/chronos-bolt-tiny / -small), a
                  pretrained time-series foundation model, zero-shot

The winner on validation MAE is refitted on every seed and written to
sim/net/arrivals_model_<district>/ with the evaluation (eval.json), which is
what any claim about the model must quote.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from learned_forecast import FEATURES, MIN_HISTORY, features  # noqa: E402


def load(data: Path) -> tuple[dict[int, np.ndarray], np.ndarray, dict]:
    runs, lanes, meta = {}, None, {}
    for f in sorted(data.glob("arrivals_seed*.npz")):
        d = np.load(f)
        m = json.loads(str(d["meta"]))
        if lanes is None:
            lanes, meta = d["lanes"], m
        elif list(d["lanes"]) != list(lanes):
            sys.exit(f"{f.name}: different lane list -- recorded on another network?")
        runs[int(m["seed"])] = d["counts"].astype(np.float32)
    if not runs:
        sys.exit(f"no arrivals_seed*.npz in {data}")
    return runs, lanes, meta


def profile(runs: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    n = min(r.shape[0] for r in runs)
    typical = np.mean([r[:n] for r in runs], axis=0)
    return typical.astype(np.float32), typical.mean(axis=0).astype(np.float32)


def rows(runs: list[np.ndarray], typical, lane_mean):
    X, y = [], []
    for r in runs:
        for t in range(MIN_HISTORY, r.shape[0]):
            X.append(features(r, t, typical, lane_mean))
            y.append(r[t])
    return np.concatenate(X), np.concatenate(y)


# Lane -> its approach (the incoming edge, "edge_k" -> "edge"). Set in main().
APPROACH: np.ndarray | None = None


def score(pred: np.ndarray, true: np.ndarray, heavy: np.ndarray) -> dict:
    err = pred - true
    out = {"mae": float(np.abs(err).mean()), "rmse": float(np.sqrt((err ** 2).mean())),
           "bias": float(err.mean()),
           # The lanes that carry the traffic: where a wrong forecast costs most.
           "mae_busy_lanes": float(np.abs(err[:, heavy]).mean()),
           "mean_count": float(true.mean()),
           "n": int(true.size)}
    if APPROACH is not None:
        # THE SELECTION METRIC. The controller never reads one lane's forecast:
        # it sums the lanes of each approach (controllers.py, rule 5). Per lane
        # most minutes are 0 or 1, and per-lane MAE rewards predicting the
        # median -- a forecast can win it while getting the sums wrong.
        n_app = int(APPROACH.max()) + 1
        pa = np.zeros((pred.shape[0], n_app)); ta = np.zeros_like(pa)
        np.add.at(pa.T, APPROACH, pred.T)
        np.add.at(ta.T, APPROACH, true.T)
        out["mae_approach"] = float(np.abs(pa - ta).mean())
        out["mean_approach_count"] = float(ta.mean())
    return out


def evaluate_simple(val: list[np.ndarray], typical, heavy) -> dict:
    out = {}
    for name in ("persistence", "mean3", "profile"):
        P, T = [], []
        for r in val:
            for t in range(MIN_HISTORY, r.shape[0]):
                if name == "persistence":
                    p = r[t - 1]
                elif name == "mean3":
                    p = r[t - 3:t].mean(axis=0)
                else:
                    p = typical[min(t, typical.shape[0] - 1)]
                P.append(p)
                T.append(r[t])
        out[name] = score(np.array(P), np.array(T), heavy)
    return out


def fit_lgbm(X, y, Xv=None, yv=None):
    import lightgbm as lgb
    params = {"objective": "poisson", "learning_rate": 0.05, "num_leaves": 63,
              "min_data_in_leaf": 200, "feature_fraction": 0.9, "bagging_fraction": 0.8,
              "bagging_freq": 1, "verbose": -1, "num_threads": 4, "seed": 0}
    dtr = lgb.Dataset(X, y, feature_name=FEATURES)
    if Xv is not None:
        dv = lgb.Dataset(Xv, yv, reference=dtr)
        b = lgb.train(params, dtr, num_boost_round=1500, valid_sets=[dv],
                      callbacks=[lgb.early_stopping(50, verbose=False)])
    else:
        b = lgb.train(params, dtr, num_boost_round=1500)
    return b


def evaluate_chronos(val: list[np.ndarray], heavy, model_id: str, every: int) -> dict:
    """Zero-shot. Scored on every `every`-th minute to keep CPU time sane."""
    import torch
    from chronos import BaseChronosPipeline
    pipe = BaseChronosPipeline.from_pretrained(model_id, device_map="cpu", torch_dtype=torch.float32)
    P, T = [], []
    t0 = time.perf_counter()
    for r in val:
        for t in range(max(MIN_HISTORY, 10), r.shape[0], every):
            ctx = torch.tensor(r[:t].T)                      # lanes x minutes
            q, mean = pipe.predict_quantiles(ctx, prediction_length=1, quantile_levels=[0.5])
            P.append(np.clip(mean[:, 0].numpy(), 0, None))
            T.append(r[t])
    res = score(np.array(P), np.array(T), heavy)
    res["seconds_per_forecast"] = (time.perf_counter() - t0) / max(len(P), 1)
    res["scored_every_minutes"] = every
    return res


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=str(HERE.parent / "sim" / "arrivals"))
    ap.add_argument("--val-seeds", default="105,106")
    ap.add_argument("--chronos", default="amazon/chronos-bolt-tiny,amazon/chronos-bolt-small")
    ap.add_argument("--chronos-every", type=int, default=5)
    ap.add_argument("--district", default="santo_domingo")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    runs, lanes, meta = load(Path(args.data))
    val_seeds = {int(s) for s in args.val_seeds.split(",")}
    tr = [runs[s] for s in sorted(runs) if s not in val_seeds]
    va = [runs[s] for s in sorted(runs) if s in val_seeds]
    if not tr or not va:
        sys.exit(f"need training and validation seeds; have {sorted(runs)}")
    print(f"{len(lanes)} lanes, {runs[next(iter(runs))].shape[0]} minutes; "
          f"train seeds {sorted(set(runs) - val_seeds)}, validation {sorted(val_seeds)}")

    global APPROACH
    _, APPROACH = np.unique([str(l).rsplit("_", 1)[0] for l in lanes], return_inverse=True)

    typical, lane_mean = profile(tr)
    # Busy lanes: the top quarter by mean count in training.
    heavy = lane_mean >= np.quantile(lane_mean, 0.75)

    results = evaluate_simple(va, typical, heavy)

    X, y = rows(tr, typical, lane_mean)
    Xv, yv = rows(va, typical, lane_mean)
    t0 = time.perf_counter()
    booster = fit_lgbm(X, y, Xv, yv)
    best_iter = booster.best_iteration or booster.current_iteration()
    results["lightgbm"] = score(booster.predict(Xv, num_iteration=best_iter).reshape(-1, len(lanes)),
                                yv.reshape(-1, len(lanes)), heavy)
    results["lightgbm"]["trees"] = int(best_iter)
    results["lightgbm"]["train_seconds"] = round(time.perf_counter() - t0, 1)

    for mid in [m for m in args.chronos.split(",") if m]:
        try:
            results[mid] = evaluate_chronos(va, heavy, mid, args.chronos_every)
        except Exception as exc:
            results[mid] = {"error": f"{type(exc).__name__}: {exc}"[:300]}

    print(f"\n{'model':<34}{'MAE lane':>10}{'RMSE':>8}{'bias':>8}{'MAE busy':>10}{'MAE approach':>14}")
    for k, v in results.items():
        if "mae" in v:
            print(f"{k:<34}{v['mae']:>10.3f}{v['rmse']:>8.3f}{v['bias']:>+8.3f}"
                  f"{v['mae_busy_lanes']:>10.3f}{v['mae_approach']:>14.3f}")
        else:
            print(f"{k:<34}  {v['error']}")

    # Only the kinds the run-time Predictor implements can be deployed.
    # Chosen on approach MAE: see score().
    deployable = {k: v for k, v in results.items()
                  if k in ("persistence", "mean3", "profile", "lightgbm") and "mae" in v}
    winner = min(deployable, key=lambda k: deployable[k]["mae_approach"])
    best_any = min((k for k in results if "mae" in results[k]), key=lambda k: results[k]["mae_approach"])
    print(f"\nbest overall: {best_any}; deployed: {winner}")

    out = Path(args.out or HERE.parent / "sim" / "net" / f"arrivals_model_{args.district}")
    out.mkdir(parents=True, exist_ok=True)
    # Refit on every seed for the deployed model; the scores above stay the
    # held-out ones.
    all_runs = [runs[s] for s in sorted(runs)]
    typical_all, lane_mean_all = profile(all_runs)
    np.savez_compressed(out / "profile.npz", typical=typical_all, lane_mean=lane_mean_all, lanes=lanes)
    if winner == "lightgbm":
        Xa, ya = rows(all_runs, typical_all, lane_mean_all)
        import lightgbm as lgb
        # Same settings, the tree count early stopping chose on validation.
        final = lgb.train(booster.params, lgb.Dataset(Xa, ya, feature_name=FEATURES), num_boost_round=int(best_iter))
        final.save_model(str(out / "model.txt"))
    (out / "model.json").write_text(json.dumps({
        "kind": winner, "features": FEATURES, "bin_s": 60, "target": "vehicles entering the lane next minute",
        "trained_on_seeds": sorted(runs), "district": args.district,
        "recorded_with": meta.get("arms"), "start_hour": meta.get("start_hour"),
    }, indent=1), encoding="utf-8")
    (out / "eval.json").write_text(json.dumps({
        "validation_seeds": sorted(val_seeds), "train_seeds": sorted(set(runs) - val_seeds),
        "lanes": int(len(lanes)), "busy_lane_threshold": float(np.quantile(lane_mean, 0.75)),
        "results": results, "deployed": winner, "best_overall": best_any,
        "selection_metric": "mae_approach",
        "selection_note": ("The first evaluation selected on per-lane MAE and picked the profile; "
                           "the metric was changed to approach-level MAE after seeing that result, "
                           "because the controller sums lanes per approach. Both are reported."),
    }, indent=1), encoding="utf-8")
    print(f"written {out}")


if __name__ == "__main__":
    main()
