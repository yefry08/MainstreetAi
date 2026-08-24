"""
Does the AI's chosen policy actually beat the rules-based defaults?

The demo's headline numbers were validated with the deterministic defaults --
compare.py and validate_seeds.py spawn workers directly, with no orchestrator
attached, so the LLM never touched those runs. The live server DOES run the
orchestrator, and it has been settling on a policy that pins two parameters to
opposite bounds:

    min_green       20.0   the CEILING of (6, 20)
    max_green_base  25.0   the FLOOR   of (25, 90)

Effective green then runs from 20 s to about 25 s, which leaves the adaptive
controller roughly five seconds of room to respond to a queue or a bus. That
is close to fixed-time behaviour, and it is worth knowing whether it costs
anything, because "the AI layer makes it worse" is exactly the result a demo
should find out about in private.

This runs the same paired experiment several times over -- identical seed,
demand and duration -- changing only the adaptive twin's policy, so the
comparison is between policies rather than between runs.

    python server/policy_ab.py [sim_seconds]
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

from sim_worker import run_worker  # noqa: E402

MODES = ("baseline", "ai")

# What the orchestrator has actually been choosing, read off /api/ai/policy.
AI_OBSERVED = {
    "min_green": 20.0,
    "max_green_base": 25.0,
    "imbalance": 1.5,
    "bus_detect_m": 120.0,
    "tsp_max_green": 70.0,
}

# AdaptiveController's own defaults -- what every validated number used.
DEFAULTS = {
    "min_green": 8.0,
    "max_green_base": 55.0,
    "imbalance": 1.15,
    "bus_detect_m": 140.0,
    "tsp_max_green": 70.0,
}

# A deliberate opposite: short floor, long ceiling, i.e. maximum room to adapt.
WIDE = {
    "min_green": 6.0,
    "max_green_base": 90.0,
    "imbalance": 1.15,
    "bus_detect_m": 140.0,
    "tsp_max_green": 110.0,
}

CANDIDATES = [
    ("defaults (validated)", DEFAULTS),
    ("AI observed", AI_OBSERVED),
    ("wide band", WIDE),
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
                print(f"\n[{mode}] ERROR\n{item['traceback'][-400:]}")
                break
            continue
        last = item[0]
        if last["metrics"]["sim_time"] >= until:
            break
    cmd_q.put({"type": "stop"})
    results[mode] = last


def run_pair(policy: dict, until: float, seed: int = 42) -> dict | None:
    ctx = mp.get_context("spawn")
    cmd_qs, out_qs, procs, results = {}, {}, {}, {}

    for mode in MODES:
        cmd_qs[mode] = ctx.Queue()
        out_qs[mode] = ctx.Queue(maxsize=4)
        p = ctx.Process(target=run_worker, args=(
            mode, cmd_qs[mode], out_qs[mode],
            {"seed": seed, "start_hour": 7.0, "end": 999999,
             "speed": 1000.0, "focus": "none"}), daemon=True)
        p.start()
        procs[mode] = p

    # Only the adaptive twin takes a policy; the baseline must stay fixed-time
    # or the comparison stops meaning anything.
    cmd_qs["ai"].put({"type": "policy", "value": policy,
                      "source": "policy_ab", "rationale": "A/B"})

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

    if not results.get("ai") or not results.get("baseline"):
        return None
    return {
        "baseline": results["baseline"]["metrics"],
        "ai": results["ai"]["metrics"],
        "applied": results["ai"]["controller"].get("policy"),
    }


def main() -> None:
    until = float(sys.argv[1]) if len(sys.argv) > 1 else 1800.0
    print(f"identical seed / demand / duration ({until:.0f}s); only the "
          f"adaptive twin's POLICY changes\n")
    print(f"{'policy':<22}{'net km/h':>10}{'vs fixed':>10}"
          f"{'bus km/h':>10}{'vs fixed':>10}{'trips':>8}{'teleports':>10}")
    print("-" * 80)

    rows = []
    for label, policy in CANDIDATES:
        r = run_pair(policy, until)
        if not r:
            print(f"{label:<22} failed")
            continue
        a, b = r["ai"], r["baseline"]

        def gain(k):
            return ((a[k] - b[k]) / b[k] * 100) if b[k] else 0.0

        rows.append((label, a, b, gain("avg_speed_kmh"), gain("bus_avg_speed_kmh"), r))
        print(f"{label:<22}{a['avg_speed_kmh']:>10.1f}{gain('avg_speed_kmh'):>9.1f}%"
              f"{a['bus_avg_speed_kmh']:>10.1f}{gain('bus_avg_speed_kmh'):>9.1f}%"
              f"{a['completed']:>8.0f}{a['teleports']:>10.0f}")

        # Confirm the policy actually reached the controller. A silently
        # ignored policy would make every row identical and look like
        # "policy does not matter", which is the wrong conclusion entirely.
        #
        # A difference is not automatically a fault: apply_policy deliberately
        # lowers min_green when the requested pair would leave the fairness cap
        # below the green floor. That correction is reported rather than
        # flagged, because it is the guard doing its job -- confusing the two
        # would train the reader to ignore the line that matters.
        applied = r.get("applied") or {}
        for k, want in policy.items():
            got = applied.get(k)
            if got is None or abs(float(got) - want) <= 1e-6:
                continue
            if k == "min_green" and float(got) < want:
                print(f"{'':22}  min_green {want:.1f} -> {float(got):.1f} "
                      f"(band guard: cap would have sat below the floor)")
            else:
                print(f"{'':22}  !! NOT APPLIED: {k} requested {want}, "
                      f"got {got}")

    if len(rows) < 2:
        return
    print("-" * 80)
    best = max(rows, key=lambda r: r[3])
    worst = min(rows, key=lambda r: r[3])
    print(f"best network speed : {best[0]}  ({best[3]:+.1f}% vs fixed-time)")
    print(f"worst              : {worst[0]}  ({worst[3]:+.1f}% vs fixed-time)")
    spread = best[3] - worst[3]
    print(f"spread             : {spread:.1f} percentage points between policies")
    if spread < 2.0:
        print("\nThe policy barely matters at this load -- the six rules are "
              "doing the work,\nand the strategic layer is close to decorative.")


if __name__ == "__main__":
    main()
