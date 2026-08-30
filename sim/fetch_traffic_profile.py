"""
Build a demand profile from REAL measured Barcelona traffic.

*** REAL DATA ***
Source: Open Data BCN, dataset `trams` — "Traffic state information by sections
of the city of Barcelona". The Ajuntament publishes the measured congestion
state of 532 road sections roughly every five minutes, as monthly archives.

That is several million real observations per month, which is enough to derive
the thing the simulation most needs and could otherwise only guess at: how
Barcelona's traffic actually varies BY HOUR AND BY DAY OF WEEK.

Until now the simulation used an hourly demand curve I wrote from published
modal-share figures — plausible, but asserted. This replaces it with a curve
measured from the city itself, and it changes what can honestly be claimed: the
peaks are no longer "a shape that looks about right", they are the shape
Barcelona has.

State encoding used by the feed (estatActual):
    0  no data          4  very dense
    1  very fluid       5  congested
    2  fluid            6  closed
    3  dense
Zeros are dropped rather than counted as free-flowing — "no data" is not the
same measurement as "empty road", and treating it as such would flatten every
night-time hour.
"""

from __future__ import annotations

import csv
import io
import json
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "web" / "public" / "data" / "traffic_profile.json"
OUT.parent.mkdir(parents=True, exist_ok=True)

BASE = "https://opendata-ajuntament.barcelona.cat/data/dataset/8319c2b1-4c21-4962-9acd-6db4c5ff1148/resource/{rid}/download"

# Monthly archives. More months means more samples per weekday; three gives
# roughly a dozen observations of each weekday, which is enough for the shape
# to stabilise.
MONTHS = {
    "2026-01": "1309e26c-54c4-4847-a1b2-38deed9937ee",
    "2026-02": "0ed5dfa6-4071-4e0e-a6b7-4a1dc647b50b",
    "2026-03": "e7e20745-af8e-4652-9ac0-d024bd3d49bb",
}

LIVE = "2d456eb5-4ea6-4f68-9794-2f3f1a58a933"

# Congestion index per state. Non-linear on purpose: the step from "dense" to
# "congested" matters far more to travel time than the step from "very fluid"
# to "fluid".
STATE_INDEX = {1: 0.10, 2: 0.25, 3: 0.55, 4: 0.75, 5: 1.00, 6: 1.00}

DOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def stream_month(label: str, rid: str, acc: dict) -> int:
    """Stream one monthly archive, accumulating (dow, hour) sums. Never held whole."""
    url = BASE.format(rid=rid)
    print(f"[trams] {label} ...", end="", flush=True)
    n = 0
    with requests.get(url, stream=True, timeout=600) as r:
        r.raise_for_status()
        # iter_lines rather than a TextIOWrapper over r.raw: the wrapper closes
        # the underlying stream out from under itself part-way through a 49 MB
        # download ("I/O operation on closed file"), and it also bypasses
        # content-encoding handling.
        lines = r.iter_lines(decode_unicode=True)
        header = next(lines, None)  # discard "idTram,data,estatActual,..."
        if header is None:
            print(" empty")
            return 0
        for line in lines:
            if not line:
                continue
            row = line.split(",")
            if len(row) < 3:
                continue
            try:
                state = int(row[2])
            except ValueError:
                continue
            if state <= 0:
                continue  # "no data" is not "free-flowing"
            idx = STATE_INDEX.get(state)
            if idx is None:
                continue
            ts = row[1]
            try:
                dt = datetime(int(ts[0:4]), int(ts[4:6]), int(ts[6:8]), int(ts[8:10]))
            except (ValueError, IndexError):
                continue
            key = (dt.weekday(), dt.hour)
            acc[key][0] += idx
            acc[key][1] += 1
            n += 1
    print(f" {n:,} usable observations")
    return n


# --------------------------------------------------------------------------
# Congestion state is NOT traffic volume, and conflating them would be a
# fabrication dressed up as real data.
#
# The feed reports how congested a section IS, not how many vehicles are on it.
# An empty road at 03:00 still reports "very fluid" rather than "nothing here",
# so the measured index has a floor around 0.45 of peak — while actual traffic
# volume at 3 a.m. is nearer a tenth of the morning peak. Feeding the raw index
# in as a demand multiplier would put roughly four times too much traffic on the
# network overnight.
#
# So the measured curve is kept as the honest artefact, and the demand
# multiplier is derived from it with a stated transform:
#
#   * the SHAPE is measured — when the peaks fall, their relative height, which
#     day is busiest, how sharply the morning rises
#   * the AMPLITUDE is rescaled to a realistic night-to-peak ratio
#
# Congestion saturates as volume rises, so inverting it needs a convex curve —
# hence the exponent above 1.
DEMAND_FLOOR = 0.10   # 03:00 relative to the busiest hour of the week
DEMAND_GAMMA = 1.8    # >1 because congestion saturates with volume


def to_demand(curve: list, c_min: float) -> list:
    """Measured congestion index -> demand multiplier. See the note above."""
    span = max(1e-6, 1.0 - c_min)
    out = []
    for c in curve:
        norm = max(0.0, (c - c_min) / span)
        out.append(round(DEMAND_FLOOR + (1.0 - DEMAND_FLOOR) * norm ** DEMAND_GAMMA, 4))
    return out


def find_peaks(weekday_curve: list) -> dict:
    """
    Locate the three daily peaks in the measured weekday curve.

    Windows are constrained to sensible parts of the day rather than taken as
    global maxima, because a single noisy hour would otherwise be reported as
    "the evening peak".
    """
    def best(lo, hi):
        window = [(h, weekday_curve[h]) for h in range(lo, hi + 1)]
        h, v = max(window, key=lambda t: t[1])
        return {"hour": h, "index": round(v, 4)}

    return {
        "morning": best(6, 11),
        "afternoon": best(12, 17),
        "evening": best(18, 23),
    }


def main() -> None:
    months = sys.argv[1:] or list(MONTHS)
    acc: dict = defaultdict(lambda: [0.0, 0])
    total = 0
    used = []

    for label in months:
        rid = MONTHS.get(label)
        if not rid:
            print(f"[trams] unknown month {label}, skipping")
            continue
        try:
            total += stream_month(label, rid, acc)
            used.append(label)
        except Exception as exc:
            print(f" failed: {type(exc).__name__}: {exc}")

    if not total:
        sys.exit("no observations gathered — is the portal reachable?")

    # mean congestion index per (day of week, hour)
    grid = [[0.0] * 24 for _ in range(7)]
    counts = [[0] * 24 for _ in range(7)]
    for (d, h), (s, c) in acc.items():
        if c:
            grid[d][h] = s / c
            counts[d][h] = c

    peak = max(max(row) for row in grid) or 1.0

    # Demand multiplier, normalised so the busiest measured hour of the week is
    # 1.0. This is what the simulation scales its signal policy against.
    demand = [[round(v / peak, 4) for v in row] for row in grid]

    # A representative weekday curve, averaged Monday-Friday.
    weekday = [round(sum(demand[d][h] for d in range(5)) / 5, 4) for h in range(24)]
    weekend = [round(sum(demand[d][h] for d in (5, 6)) / 2, 4) for h in range(24)]

    c_min = min(min(row) for row in demand)

    profile = {
        "source": {
            "name": "Open Data BCN — trams (traffic state by section)",
            "url": "https://opendata-ajuntament.barcelona.cat/data/dataset/trams",
            "kind": "real measured data",
            "months": used,
            "observations": total,
            "sections": 532,
            "note": "Mean congestion index by day of week and hour, normalised "
                    "so the busiest measured hour of the week is 1.0. State 0 "
                    "('no data') is excluded rather than counted as free-flowing.",
            # The divisor used for that normalisation, in raw STATE_INDEX
            # units. Recorded because without it the curve cannot be compared
            # against anything else measured on the same scale -- notably a
            # LIVE reading from the same feed, which is the obvious question
            # to ask of it ("is the city busier than usual right now?").
            # Recovering it afterwards means re-streaming every observation.
            "peak_raw": round(peak, 6),
            "state_index": STATE_INDEX,
        },
        "derivation": {
            "congestion_is_not_volume": (
                "The feed reports how congested a section is, not how many "
                "vehicles are on it. An empty road still reports 'very fluid', "
                "so the measured index floors around 0.45 of peak overnight "
                "while real volume is nearer 0.10. demand_by_day is therefore "
                "DERIVED: the shape is measured, the amplitude is rescaled."
            ),
            "floor": DEMAND_FLOOR,
            "gamma": DEMAND_GAMMA,
            "formula": "demand = floor + (1-floor) * ((c - c_min)/(1 - c_min))**gamma",
            "c_min": round(c_min, 4),
        },
        # Measured, unmodified.
        "congestion_by_day": {DOW[d]: demand[d] for d in range(7)},
        "congestion_weekday_mean": weekday,
        "congestion_weekend_mean": weekend,
        # Derived from the above — this is what the simulation consumes.
        "demand_by_day": {DOW[d]: to_demand(demand[d], c_min) for d in range(7)},
        "demand_weekday_mean": to_demand(weekday, c_min),
        "samples_by_day": {DOW[d]: sum(counts[d]) for d in range(7)},
        "peaks": {DOW[d]: find_peaks(demand[d]) for d in range(7)},
        "weekday_peaks": find_peaks(weekday),
    }

    OUT.write_text(json.dumps(profile, indent=1), encoding="utf-8")

    print(f"\n[ok] {OUT.name} — {total:,} observations across {len(used)} month(s)")
    print("\n  weekday curve (mean Mon-Fri, 1.0 = busiest hour of the week):")
    bars = "".join(
        f"    {h:02d}:00 {'#' * int(weekday[h] * 44):<44} {weekday[h]:.3f}\n"
        for h in range(24)
    )
    print(bars, end="")
    wp = profile["weekday_peaks"]
    print(f"  measured weekday peaks:")
    for name in ("morning", "afternoon", "evening"):
        p = wp[name]
        print(f"    {name:<10} {p['hour']:02d}:00  index {p['index']:.3f}")
    print("\n  busiest day:",
          max(profile["by_day"], key=lambda d: sum(profile["by_day"][d])))


if __name__ == "__main__":
    main()
