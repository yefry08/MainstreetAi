"""
A learned forecast of arrivals, per signal-controlled lane, one minute ahead.

WHY THIS EXISTS
The forecast the controller had until now (web/scripts/build-events.mjs) is a
hand-written schedule: schools fill at 6:45, offices empty at 17:00. A 5-seed
ablation measured what it adds -- +0.9 % network speed, -1.3 % CO2, and an
effect on stopped time that could not be told apart from zero
(sim/ablation_santo_domingo.json). This module replaces the schedule with a
model that learns, from counts, how many vehicles will reach each approach in
the next minute.

WHAT IT SEES
Only what a city could measure: vehicles entering each controlled lane, counted
per minute -- the same thing a loop detector at the upstream end of an approach
records. No route, no destination, no vehicle identity leaves this module.

THREE PIECES
  ArrivalCounter  counts entries per lane per BIN_S, live, inside the worker.
                  The same counter records training data (record_arrivals.py)
                  and feeds the model at run time, so the two cannot drift.
  features()      the model's inputs for every lane at one minute: recent
                  counts, the lane's typical count at that minute, the time.
  Predictor       loads a trained model and turns the counter's history into
                  predicted arrivals per lane for the next minute.

Training and evaluation: train_forecast.py. Simulation data, so the model
learns the simulator's demand, not the city's; it has to be retrained on real
counts before it says anything about Santo Domingo.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

BIN_S = 60.0          # one count per lane per simulated minute
LAGS = 10             # minutes of history the model reads
MIN_HISTORY = 3       # minutes counted before any prediction is made


class ArrivalCounter:
    """Vehicles entering each controlled lane, per BIN_S, from the bulk subscription."""

    def __init__(self, lanes: list[str], start: float = 0.0):
        self.lanes = list(lanes)
        self.index = {l: i for i, l in enumerate(self.lanes)}
        self.cur = np.zeros(len(self.lanes), dtype=np.float32)
        self.rows: list[np.ndarray] = []
        self.next_edge = start + BIN_S
        self._lane_of: dict[str, str] = {}

    def see(self, vid: str, lane: str | None) -> None:
        """One vehicle's lane this step; counts it when it has just entered a controlled lane."""
        if not lane or self._lane_of.get(vid) == lane:
            return
        self._lane_of[vid] = lane
        i = self.index.get(lane)
        if i is not None:
            self.cur[i] += 1.0

    def forget(self, vid: str) -> None:
        self._lane_of.pop(vid, None)

    def tick(self, sim_time: float) -> bool:
        """Close the minute when sim_time has reached its end. True when a row was added."""
        closed = False
        while sim_time >= self.next_edge:
            self.rows.append(self.cur.copy())
            self.cur[:] = 0.0
            self.next_edge += BIN_S
            closed = True
        return closed

    def history(self) -> np.ndarray:
        """Counts so far, minutes x lanes."""
        if not self.rows:
            return np.zeros((0, len(self.lanes)), dtype=np.float32)
        return np.stack(self.rows)

    def save(self, path: Path, meta: dict) -> None:
        np.savez_compressed(path, counts=self.history(), lanes=np.array(self.lanes),
                            meta=json.dumps(meta))


# --------------------------------------------------------------------------
# Features: one row per (lane, minute). Shared by training and run time.
# --------------------------------------------------------------------------
FEATURES = [f"lag{k}" for k in range(1, LAGS + 1)] + [
    "mean3", "mean10", "typical", "typical_next", "minute", "lane_mean"]


def features(hist: np.ndarray, t: int, typical: np.ndarray, lane_mean: np.ndarray) -> np.ndarray:
    """
    Inputs for predicting minute `t` (0-based) of every lane from minutes < t.

    hist      minutes x lanes counts observed so far (at least t rows)
    typical   minutes x lanes: the training runs' mean count per lane and
              minute -- the "historical profile" a city would have from a
              year of loop data
    lane_mean lanes: the lane's overall mean count
    """
    n_lanes = hist.shape[1]
    lags = np.zeros((n_lanes, LAGS), dtype=np.float32)
    for k in range(1, LAGS + 1):
        if t - k >= 0:
            lags[:, k - 1] = hist[t - k]
    seen = hist[max(0, t - 10):t]
    mean10 = seen.mean(axis=0) if len(seen) else np.zeros(n_lanes, np.float32)
    seen3 = hist[max(0, t - 3):t]
    mean3 = seen3.mean(axis=0) if len(seen3) else np.zeros(n_lanes, np.float32)
    tt = min(t, typical.shape[0] - 1)
    typ_prev = typical[max(0, tt - 1)]
    typ_next = typical[tt]
    minute = np.full(n_lanes, float(t), dtype=np.float32)
    return np.column_stack([lags, mean3, mean10, typ_prev, typ_next, minute, lane_mean]).astype(np.float32)


class Predictor:
    """
    The trained model, at run time. `predict(counter)` returns predicted
    arrivals per lane for the minute now starting, or None before there is
    enough history.
    """

    def __init__(self, model_dir: Path, lanes: list[str]):
        meta = json.loads((model_dir / "model.json").read_text(encoding="utf-8"))
        self.kind = meta["kind"]
        trained_lanes = list(np.load(model_dir / "profile.npz")["lanes"])
        prof = np.load(model_dir / "profile.npz")
        # Align the trained lane order to this run's: a lane the model never
        # saw gets a zero profile and is predicted from its own counts alone.
        pos = {l: i for i, l in enumerate(trained_lanes)}
        idx = np.array([pos.get(l, -1) for l in lanes])
        typical = prof["typical"]
        self.typical = np.where(idx[None, :] >= 0, typical[:, np.maximum(idx, 0)], 0.0).astype(np.float32)
        self.lane_mean = np.where(idx >= 0, prof["lane_mean"][np.maximum(idx, 0)], 0.0).astype(np.float32)
        self.coverage = float((idx >= 0).mean()) if len(idx) else 0.0
        self.meta = meta
        if self.kind == "lightgbm":
            import lightgbm as lgb
            self.booster = lgb.Booster(model_file=str(model_dir / "model.txt"))
        elif self.kind not in ("profile", "persistence", "mean3"):
            raise ValueError(f"unknown forecast model kind {self.kind!r}")

    def predict(self, counter: ArrivalCounter) -> np.ndarray | None:
        hist = counter.history()
        t = hist.shape[0]
        if t < MIN_HISTORY:
            return None
        # The simple baselines are deployable too: if one of them wins on
        # held-out seeds, the trained model has not earned its place.
        if self.kind == "persistence":
            return hist[-1].copy()
        if self.kind == "mean3":
            return hist[-3:].mean(axis=0)
        if self.kind == "profile":
            return self.typical[min(t, self.typical.shape[0] - 1)].copy()
        x = features(hist, t, self.typical, self.lane_mean)
        return np.clip(self.booster.predict(x), 0.0, None).astype(np.float32)
