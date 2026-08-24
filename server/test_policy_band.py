"""
A policy must be legal as a WHOLE, not just parameter by parameter.

Each bound in POLICY_BOUNDS is individually sane. Their interaction was not
constrained, and the orchestrator found the hole: min_green at its ceiling
(20 s) with max_green_base at its floor (25 s) puts the fairness cap BELOW the
minimum green at low demand, so rule 4 can never fire and every phase runs
exactly min_green. The adaptive controller becomes fixed-time control with an
adaptive label.

Measured cost of that combination on identical seed and demand: +20.7% network
speed against +38.2% for the defaults -- 17.5 points, 89 completed trips, and
42% more teleports (server/policy_ab.py).

These tests need no SUMO: apply_policy is pure arithmetic over the controller's
own attributes.

Run:  python server/test_policy_band.py
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from controllers import MIN_GREEN_BAND_RATIO, AdaptiveController  # noqa: E402

failures = 0


def check(name, ok, detail=""):
    global failures
    if not ok:
        failures += 1
    print(f"  {'ok  ' if ok else 'FAIL'} {name}{'   ' + detail if detail else ''}")


class Bare(AdaptiveController):
    """apply_policy only touches plain attributes, so skip SUMO entirely."""

    def __init__(self):
        self.min_green = 8.0
        self.max_green_base = 55.0
        self.tsp_max_green = 70.0
        self.bus_detect_m = 140.0
        self.imbalance = 1.15
        self.policy_source = "default"
        self.policy_rationale = ""


def worst_max_green(c):
    """Effective cap at zero demand: max_green_base * (0.62 + 0.55*0)."""
    return c.max_green_base * 0.62


# ---- the exact policy the orchestrator chose ----------------------------
c = Bare()
applied = c.apply_policy({
    "min_green": 20.0, "max_green_base": 25.0, "imbalance": 1.5,
    "bus_detect_m": 120.0, "tsp_max_green": 70.0,
})
check("degenerate pair is corrected", c.min_green < 20.0,
      f"min_green {c.min_green:.1f}")
check("correction is reported", applied.get("min_green_reduced_for_band") is True)
check("cap now clears the floor at zero demand",
      worst_max_green(c) >= c.min_green * MIN_GREEN_BAND_RATIO - 1e-9,
      f"cap {worst_max_green(c):.1f} vs floor {c.min_green:.1f}")
check("max_green_base is left alone",
      c.max_green_base == 25.0, f"{c.max_green_base}")

# ---- pedestrian clearance is never traded away --------------------------
# A very low cap cannot be made to fit; the 6 s floor wins and the band simply
# stays narrow. Safety is not a variable the band ratio gets to spend.
c = Bare()
c.apply_policy({"min_green": 20.0, "max_green_base": 25.0})
check("min_green never goes below the 6 s pedestrian floor",
      c.min_green >= 6.0, f"{c.min_green:.2f}")

# ---- a healthy policy is untouched --------------------------------------
c = Bare()
applied = c.apply_policy({"min_green": 8.0, "max_green_base": 55.0})
check("validated defaults pass through unchanged",
      c.min_green == 8.0 and c.max_green_base == 55.0,
      f"{c.min_green}/{c.max_green_base}")
check("no correction flag on a healthy policy",
      "min_green_reduced_for_band" not in applied)

c = Bare()
c.apply_policy({"min_green": 6.0, "max_green_base": 90.0})
check("wide band passes through unchanged",
      c.min_green == 6.0 and c.max_green_base == 90.0)

# ---- individual bounds still enforced -----------------------------------
c = Bare()
c.apply_policy({"min_green": 999.0, "max_green_base": 999.0,
                "imbalance": 99.0, "bus_detect_m": 1e6, "tsp_max_green": 1e6})
check("out-of-range values are still clamped",
      c.max_green_base == 90.0 and c.imbalance == 2.0
      and c.bus_detect_m == 220.0 and c.tsp_max_green == 110.0,
      f"{c.max_green_base}/{c.imbalance}/{c.bus_detect_m}/{c.tsp_max_green}")
check("min_green stays within its own ceiling too", c.min_green <= 20.0,
      f"{c.min_green}")

# ---- junk does not move anything ----------------------------------------
c = Bare()
c.apply_policy({"min_green": "nonsense", "max_green_base": None})
check("unparseable values are ignored, not applied",
      c.min_green == 8.0 and c.max_green_base == 55.0,
      f"{c.min_green}/{c.max_green_base}")

# ---- rule 4 is reachable across the whole demand range ------------------
# The guard is only worth having if it holds everywhere the simulation runs,
# not just at the one demand level that happened to expose the bug.
bad = []
for mg in (6.0, 10.0, 14.0, 20.0):
    for mgb in (25.0, 40.0, 55.0, 90.0):
        c = Bare()
        c.apply_policy({"min_green": mg, "max_green_base": mgb})
        for df in (0.0, 0.1, 0.4, 0.79, 1.0):
            cap = c.max_green_base * (0.62 + 0.55 * df)
            if cap <= c.min_green and c.min_green > 6.0:
                bad.append(f"mg={mg} mgb={mgb} df={df}")
check("rule 4 reachable for every in-bounds pair", not bad,
      "; ".join(bad[:3]))

print(f"\n{failures} FAILED" if failures else "\nall passed")
sys.exit(1 if failures else 0)
