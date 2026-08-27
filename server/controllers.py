"""
Traffic-signal control policies.

Two policies run side by side on two identical copies of the simulation:

  FixedTimeController  -- does nothing. SUMO runs the static program that
                          netconvert derived from OSM (~88 s cycle, fixed
                          splits). This is the "before" case, and it is a fair
                          representation of how most of Barcelona's 1,151
                          junctions are actually timed today.

  AdaptiveController   -- the AI layer. A rules-based actuated policy with
                          three inputs, exactly as specified:
                            (a) queue length per approach,
                            (b) transit signal priority for approaching buses,
                            (c) time-of-day demand scaling.

Design notes that matter for the pitch:

* The adaptive policy never invents a phase. It only decides, at each control
  tick, whether to HOLD the current green or RELEASE it early. SUMO then runs
  its own safe yellow/all-red transition. That means we cannot produce an unsafe
  signal state -- a real constraint any deployable system would need.

* min_green is enforced unconditionally. Even under a bus priority request we
  never cut a green shorter than the pedestrian clearance minimum.

* This is deliberately NOT reinforcement learning. It is auditable: every
  decision the controller makes is explainable in one sentence, which is what a
  city transport authority would require before letting it touch live hardware.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field


# --------------------------------------------------------------------------
# Time-of-day demand profile — MEASURED, not asserted
# --------------------------------------------------------------------------
# Derived from 3.24 million real observations of Barcelona's own traffic-state
# feed (Open Data BCN `trams`, 532 road sections, Jan-Mar 2026). See
# sim/fetch_traffic_profile.py, which also documents why the measured
# congestion index is rescaled before being used as a demand multiplier:
# congestion state is not traffic volume, and an empty road still reports
# "fluid".
#
# What this buys, beyond accuracy: the peaks are no longer a shape someone drew
# because it looked plausible. Morning 08:00, afternoon 17:00, evening 18:00,
# Friday busiest — those are the hours Barcelona actually has.
#
# The literal table below is a fallback for when the profile has not been
# built. It is the old hand-written curve and is clearly worse; the code says
# which one is in use so the distinction never gets lost.
import json as _json
import os as _os
from pathlib import Path as _Path

_FALLBACK_HOURLY = {
    0: 0.12, 1: 0.07, 2: 0.05, 3: 0.04, 4: 0.05, 5: 0.12,
    6: 0.35, 7: 0.72, 8: 1.00, 9: 0.88, 10: 0.70, 11: 0.68,
    12: 0.72, 13: 0.78, 14: 0.80, 15: 0.74, 16: 0.72, 17: 0.85,
    18: 0.97, 19: 1.00, 20: 0.86, 21: 0.60, 22: 0.40, 23: 0.24,
}

DOW_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday",
             "Friday", "Saturday", "Sunday"]

_PROFILE_PATH = (_Path(__file__).resolve().parent.parent
                 / "web" / "public" / "data" / "traffic_profile.json")


def _load_profile() -> dict | None:
    try:
        return _json.loads(_PROFILE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None


PROFILE = _load_profile()
PROFILE_SOURCE = (
    "measured" if PROFILE and PROFILE.get("demand_by_day") else "fallback"
)


def demand_curve(day: str | int = "Friday") -> list:
    """24 hourly demand multipliers for a named day (or weekday index)."""
    if isinstance(day, int):
        day = DOW_NAMES[day % 7]
    if PROFILE:
        by_day = PROFILE.get("demand_by_day") or {}
        if day in by_day:
            return by_day[day]
        wk = PROFILE.get("demand_weekday_mean")
        if wk:
            return wk
    return [_FALLBACK_HOURLY[h] for h in range(24)]


# How much of the measured demand this network can actually clear.
#
# The profile in traffic_profile.json is a MEASURED shape and stays untouched;
# this scales it. Without it the morning peak inserts more traffic than the
# network can discharge, backlog accumulates over the run, and by three
# simulated hours both twins are crawling -- 9.0 km/h fixed-time against
# 11.1 km/h adaptive. The AI still wins every metric there, but two jams that
# differ by 2 km/h is not a demo; you cannot SEE the difference.
#
# Calibration (fresh simulation pair per point, server/calibrate.py) put the
# best operating point at scale 0.70: 1,409 vehicles, 16.5 km/h fixed-time
# against 20.4 km/h adaptive. The measured Friday peak is 0.885, so
# 0.70 / 0.885 = 0.79 maps the real curve onto that point while preserving
# its shape -- the three peaks stay where the data put them, they just stop
# overflowing the network.
#
# Raise it for a more congested picture, lower it for free-flow. Override with
# MAINSTREET_CAPACITY without editing this file.
#
# THIS IS CALIBRATED FOR A SHORT RUN, and drifts over a long one. Measured on
# one continuous session:
#
#     0.5 h    ~1,400 vehicles    31% halting    +38% network speed
#     3.0 h    ~3,400 vehicles    69% halting    +23%
#     4.2 h    ~3,100 vehicles    73% halting    +16.5%
#
# Insertion still slightly exceeds what the network clears, so vehicles
# accumulate and the advantage narrows as the jam deepens. Step time grows with
# it -- at 4.2 h the simulation runs at 0.47x realtime, so the clock visibly
# crawls. Restart before showing it; a fresh run sits at the calibrated point.
#
# The obvious fix -- feed `running` back into the scale so insertion eases off
# as the network fills -- MUST NOT be done. Both twins are scaled from the
# clock alone, which is the only reason they carry identical demand and the
# A/B means anything. Load feedback would insert more into whichever twin is
# less congested, and that is always the AI twin, so the adaptive controller
# would be handed extra throughput and the comparison would quietly measure
# the feedback loop instead of the policy.
# Lowered from 0.79 to 0.5 for the demo build.
#
# 0.79 was calibrated to maximise the MEASURED advantage, and it does: ~1,400
# vehicles at the operating point. But it is also where the network is closest
# to saturating, which is where the long-run drift bites hardest and where a
# screenshot reads as a wall of sprites rather than as traffic. The brief for
# the demo is legibility and stability over density, and the AI gain is
# famously flat across this range -- the calibration sweep measured +16% to
# +25% from 231 vehicles all the way to 1,859 -- so most of the density buys
# very little argument.
NETWORK_CAPACITY = float(_os.environ.get("MAINSTREET_CAPACITY", "0.5"))

# The fairness cap must sit at least this many times above the minimum green,
# or there is no range for the controller to act within. 1.5 is deliberately
# modest: it is enough to keep rule 4 reachable at every demand level without
# second-guessing an otherwise legal policy. See AdaptiveController.apply_policy.
MIN_GREEN_BAND_RATIO = 1.5


def demand_factor(sim_time: float, start_hour: float = 7.0,
                  day: str | int = "Friday") -> float:
    """Smoothly interpolated demand multiplier for the current simulated clock."""
    curve = demand_curve(day)
    hour = (start_hour + sim_time / 3600.0) % 24.0
    lo = int(math.floor(hour)) % 24
    hi = (lo + 1) % 24
    frac = hour - math.floor(hour)
    return (curve[lo] * (1 - frac) + curve[hi] * frac) * NETWORK_CAPACITY


def peaks_for(day: str | int = "Friday") -> dict:
    """The measured morning / afternoon / evening peak hours for a day."""
    if isinstance(day, int):
        day = DOW_NAMES[day % 7]
    if PROFILE:
        p = (PROFILE.get("peaks") or {}).get(day)
        if p:
            return p
        return PROFILE.get("weekday_peaks", {})
    return {"morning": {"hour": 8}, "afternoon": {"hour": 14}, "evening": {"hour": 19}}


def clock_string(sim_time: float, start_hour: float = 7.0) -> str:
    hour = (start_hour + sim_time / 3600.0) % 24.0
    h = int(hour)
    m = int((hour - h) * 60)
    return f"{h:02d}:{m:02d}"


# --------------------------------------------------------------------------
# Per-junction static structure, read once at startup
# --------------------------------------------------------------------------
@dataclass
class JunctionPlan:
    tls_id: str
    # index -> True if this phase is a "servable" green (not a yellow/all-red)
    is_green: list[bool]
    # index -> lanes that get a green ball in this phase
    green_lanes: list[tuple[str, ...]]
    # index -> link indices that get green in this phase
    green_links: list[frozenset[int]]
    all_lanes: tuple[str, ...]
    n_phases: int

    # mutable runtime state
    phase_started: float = 0.0
    last_phase: int = -1
    held_seconds: float = 0.0
    tsp_grants: int = 0
    early_releases: int = 0
    extensions: int = 0


def build_plans(conn, tls_ids: list[str]) -> dict[str, JunctionPlan]:
    """Read each signal's program once and precompute its phase->lane mapping."""
    plans: dict[str, JunctionPlan] = {}

    for tid in tls_ids:
        try:
            logics = conn.trafficlight.getAllProgramLogics(tid)
            if not logics:
                continue
            phases = logics[0].phases
            links = conn.trafficlight.getControlledLanes(tid)  # lane per link index
        except Exception:
            continue

        is_green, green_lanes, green_links = [], [], []
        for ph in phases:
            state = ph.state
            # A phase is a usable green if it shows a green ball somewhere and
            # is not a transition (yellow) phase.
            servable = ("G" in state or "g" in state) and "y" not in state
            idxs = frozenset(i for i, c in enumerate(state) if c in "Gg")
            lanes = tuple(sorted({links[i] for i in idxs if i < len(links)}))
            is_green.append(servable)
            green_links.append(idxs)
            green_lanes.append(lanes)

        if not any(is_green):
            continue

        plans[tid] = JunctionPlan(
            tls_id=tid,
            is_green=is_green,
            green_lanes=green_lanes,
            green_links=green_links,
            all_lanes=tuple(sorted(set(links))),
            n_phases=len(phases),
        )

    return plans


# --------------------------------------------------------------------------
# Baseline
# --------------------------------------------------------------------------
class FixedTimeController:
    """The 'before' case: hands off. SUMO runs the fixed OSM-derived program."""

    name = "baseline"
    label = "Fixed-time (today)"

    def __init__(self, conn, plans: dict[str, JunctionPlan]):
        self.conn = conn
        self.plans = plans
        self.stats = {"tsp_grants": 0, "early_releases": 0, "extensions": 0}

    def step(self, sim_time: float, halt_fn, bus_requests: dict) -> None:
        return  # intentionally empty

    def explain(self, tls_id: str) -> str:
        return "Fixed 88 s cycle, equal splits. No sensing."


# --------------------------------------------------------------------------
# The AI layer
# --------------------------------------------------------------------------
class AdaptiveController:
    """
    Rules-based actuated control with transit priority.

    Each control tick, for every junction currently showing a green phase, we
    compute:

        served   = vehicles queued on approaches that HAVE green right now
        waiting  = vehicles queued on approaches that are held at red
        bus_here = a bus is within the detection zone on a green approach
        bus_wait = a bus is within the detection zone on a red approach

    and then apply, in strict priority order:

        1. HOLD   if the green is younger than min_green            (safety)
        2. RELEASE if a bus is waiting at red and none is being served (TSP)
        3. HOLD   if a bus is being served and we are under tsp_max   (TSP)
        4. RELEASE if the green has run to max_green                  (fairness)
        5. HOLD   if the served queue still dominates the waiting one (throughput)
        6. RELEASE otherwise

    Rule 5 is the congestion-reduction lever, rules 2-3 are the mode-shift
    lever: a bus carrying 80 people should not wait behind 6 cars carrying 8.
    """

    name = "ai"
    label = "AI-adaptive"

    def __init__(self, conn, plans: dict[str, JunctionPlan], *, start_hour: float = 7.0):
        self.conn = conn
        self.plans = plans
        self.start_hour = start_hour

        # --- tunable policy parameters ---
        self.min_green = 8.0          # never truncate below this
        self.max_green_base = 55.0    # scaled by time-of-day demand
        self.tsp_max_green = 70.0     # a bus may stretch a green this far
        self.bus_detect_m = 140.0     # transit detection zone before stop line
        self.imbalance = 1.15         # served must beat waiting by this to hold
        self.hold_chunk = 6.0         # seconds of green granted per hold

        self.stats = {"tsp_grants": 0, "early_releases": 0, "extensions": 0}
        self._last_reason: dict[str, str] = {}
        # Set by the AI orchestration layer, if one is configured. Purely
        # informational here — the parameters above are what actually run.
        self.policy_source = "default"
        self.policy_rationale = ""
        # When we grant a hold we already know when the green will now expire,
        # so we can skip re-issuing the command until it is nearly up. Without
        # this we were sending ~500 setPhaseDuration calls every single step.
        self._green_until: dict[str, float] = {}
        # De-duplicates transit-priority counting; see _count_tsp.
        self._tsp_marker: dict[str, tuple] = {}

    # ---------------------------------------------------------------
    def step(self, sim_time: float, halt_fn, bus_requests: dict) -> None:
        """
        `halt_fn(lane) -> int` returns the standing queue on one lane. It is a
        lazy accessor rather than a prebuilt dict on purpose: after the fast path
        below we only look at roughly a quarter of the 1,151 junctions on any
        given second, so polling all 6,558 controlled lanes every step would be
        mostly wasted work.
        """
        conn = self.conn
        df = demand_factor(sim_time, self.start_hour)
        # Busier hour -> allow longer greens (fewer, bigger platoons).
        max_green = self.max_green_base * (0.62 + 0.55 * df)

        for tid, plan in self.plans.items():
            try:
                phase = conn.trafficlight.getPhase(tid)
            except Exception:
                continue

            if phase != plan.last_phase:
                plan.last_phase = phase
                plan.phase_started = sim_time
                self._green_until.pop(tid, None)

            if phase >= len(plan.is_green) or not plan.is_green[phase]:
                continue  # a yellow/all-red transition: let SUMO run it

            elapsed = sim_time - plan.phase_started

            # ---- rule 1: minimum green is inviolable ----
            if elapsed < self.min_green:
                self._hold(tid, plan, sim_time, "min green")
                continue

            # Fast path: this green is already held with time to spare and no bus
            # is asking for anything, so there is nothing to decide yet. This is
            # also how real actuated controllers behave -- they poll their loop
            # detectors on an interval, they do not re-derive the world at 1 Hz.
            if (self._green_until.get(tid, -1.0) - sim_time > 2.0
                    and tid not in bus_requests
                    and elapsed < max_green):
                continue

            green_lanes = plan.green_lanes[phase]
            green_links = plan.green_links[phase]

            q = {l: halt_fn(l) for l in plan.all_lanes}
            served = sum(q[l] for l in green_lanes if l in q)
            waiting = sum(q.values()) - served

            req = bus_requests.get(tid)
            bus_here = bus_wait = False
            if req:
                for link_idx in req:
                    if link_idx in green_links:
                        bus_here = True
                    else:
                        bus_wait = True

            # ---- rule 2: a bus is stuck at red -> release the green early ----
            if bus_wait and not bus_here:
                self._release(tid, plan, sim_time, "transit priority: bus held at red")
                self._count_tsp(tid, plan, phase)
                continue

            # ---- rule 3: a bus is coming through -> hold the green for it ----
            if bus_here and elapsed < self.tsp_max_green:
                self._hold(tid, plan, sim_time, "transit priority: holding green for bus")
                self._count_tsp(tid, plan, phase)
                continue

            # ---- rule 4: fairness cap ----
            if elapsed >= max_green:
                self._release(tid, plan, sim_time, f"max green {max_green:.0f}s reached")
                continue

            # ---- rule 5: keep serving the heavier direction ----
            if served > 0 and served >= waiting * self.imbalance:
                self._hold(tid, plan, sim_time, f"queue {served} vs {waiting}: holding")
                continue

            # ---- rule 6: nothing left to serve ----
            if served == 0 and waiting > 0:
                self._release(tid, plan, sim_time, "approach empty, cross traffic waiting")
                continue
            if served == 0 and waiting == 0:
                # Junction is idle. Let it cycle normally rather than freezing.
                continue

            self._release(tid, plan, sim_time, f"queue {served} vs {waiting}: switching")

    # ---------------------------------------------------------------
    def apply_policy(self, policy: dict, source: str = "ai", rationale: str = "") -> dict:
        """
        Adopt a policy from the strategic (AI) layer.

        The values are ALREADY clamped by ai.orchestrator.clamp_policy before
        they reach here, and they are clamped again below. That duplication is
        deliberate: this is the last line before parameters reach 1,151 live
        signal controllers, and a bound that only exists in the caller is a
        bound that disappears the first time someone adds a second caller.

        Only the tunable knobs are exposed. Nothing here can change the
        controller's STRUCTURE — the six rules, their priority order, and the
        fact that clearance intervals are always run by SUMO are fixed in code
        and unreachable from the model.
        """
        limits = {
            "min_green": (6.0, 20.0),
            "max_green_base": (25.0, 90.0),
            "imbalance": (1.0, 2.0),
            "bus_detect_m": (60.0, 220.0),
            "tsp_max_green": (30.0, 110.0),
        }
        applied = {}
        for key, (lo, hi) in limits.items():
            if key not in policy:
                continue
            try:
                v = max(lo, min(hi, float(policy[key])))
            except (TypeError, ValueError):
                continue
            setattr(self, key, v)
            applied[key] = v

        # ---- the parameters must also be legal TOGETHER --------------------
        # Every bound above is validated on its own, and none of them is wrong.
        # Their INTERACTION was unconstrained, and that is enough to produce a
        # controller that cannot adapt at all: max_green is derived as
        # max_green_base * (0.62 + 0.55 * demand), so picking the ceiling of
        # min_green (20) with the floor of max_green_base (25) yields a cap of
        # 16.9 s at low demand -- BELOW the 20 s floor. Rule 4 then never fires,
        # every phase runs exactly min_green, and the adaptive twin degenerates
        # into fixed-time control wearing an adaptive badge.
        #
        # That is not hypothetical. The orchestrator settled on exactly that
        # pair, and measured against the defaults on identical seed and demand
        # it cost 17.5 points of network speed (+20.7% vs +38.2%), 89 completed
        # trips, and 42% more teleports. See server/policy_ab.py.
        #
        # min_green is the parameter that gives way, never max_green_base:
        # raising the cap would lengthen reds beyond what has been validated,
        # whereas lowering the floor only restores headroom. The 6 s pedestrian
        # clearance minimum is never crossed -- if the band cannot be opened
        # without breaching it, the floor stays and the band stays narrow.
        worst_max_green = self.max_green_base * 0.62      # at zero demand
        floor_lo = limits["min_green"][0]
        needed = worst_max_green / MIN_GREEN_BAND_RATIO
        if self.min_green > needed:
            adjusted = max(floor_lo, needed)
            if adjusted < self.min_green:
                self.min_green = adjusted
                applied["min_green"] = adjusted
                applied["min_green_reduced_for_band"] = True

        self.policy_source = source
        self.policy_rationale = str(rationale)[:240]
        return applied

    def current_policy(self) -> dict:
        return {
            "min_green": self.min_green,
            "max_green_base": self.max_green_base,
            "imbalance": self.imbalance,
            "bus_detect_m": self.bus_detect_m,
            "tsp_max_green": self.tsp_max_green,
            "source": self.policy_source,
            "rationale": self.policy_rationale,
        }

    def _count_tsp(self, tid: str, plan: JunctionPlan, phase: int) -> None:
        """
        Count one transit-priority intervention per junction per phase.

        Counting every control tick a bus is in range would inflate this by
        roughly the number of ticks the bus spends inside the 140 m detection
        zone -- a single bus would register a dozen "grants". What a transport
        engineer means by a priority grant is one signal decision, so that is
        what we record.
        """
        marker = (tid, phase, int(plan.phase_started))
        if self._tsp_marker.get(tid) == marker:
            return
        self._tsp_marker[tid] = marker
        plan.tsp_grants += 1
        self.stats["tsp_grants"] += 1

    def _hold(self, tid: str, plan: JunctionPlan, sim_time: float, reason: str) -> None:
        self._last_reason[tid] = reason
        # Already holding and the green still has room? Nothing to send.
        if self._green_until.get(tid, -1.0) - sim_time > 2.0:
            return
        try:
            self.conn.trafficlight.setPhaseDuration(tid, self.hold_chunk)
            self._green_until[tid] = sim_time + self.hold_chunk
            plan.held_seconds += self.hold_chunk
            plan.extensions += 1
            self.stats["extensions"] += 1
        except Exception:
            pass

    def _release(self, tid: str, plan: JunctionPlan, sim_time: float, reason: str) -> None:
        self._last_reason[tid] = reason
        try:
            # Duration 0 makes SUMO advance to the next phase on the next step,
            # running its own yellow/all-red clearance. We never skip clearance.
            self.conn.trafficlight.setPhaseDuration(tid, 0)
            self._green_until.pop(tid, None)
            plan.early_releases += 1
            self.stats["early_releases"] += 1
        except Exception:
            pass

    def explain(self, tls_id: str) -> str:
        return self._last_reason.get(tls_id, "monitoring, no intervention needed")
