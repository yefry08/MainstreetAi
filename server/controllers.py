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
# Time-of-day demand profile
# --------------------------------------------------------------------------
# Relative traffic intensity by hour, shaped to the Barcelona working-day
# pattern: a sharp 08:00-09:30 commute peak, a broad midday plateau (the city
# genuinely does not empty at lunch), and a heavier, longer evening peak from
# 18:00-20:30. Used to scale max_green -- longer cycles when demand is high,
# snappier cycles when it is not.
HOURLY_DEMAND = {
    0: 0.12, 1: 0.07, 2: 0.05, 3: 0.04, 4: 0.05, 5: 0.12,
    6: 0.35, 7: 0.72, 8: 1.00, 9: 0.88, 10: 0.70, 11: 0.68,
    12: 0.72, 13: 0.78, 14: 0.80, 15: 0.74, 16: 0.72, 17: 0.85,
    18: 0.97, 19: 1.00, 20: 0.86, 21: 0.60, 22: 0.40, 23: 0.24,
}


def demand_factor(sim_time: float, start_hour: float = 7.0) -> float:
    """Smoothly interpolated demand multiplier for the current simulated clock."""
    hour = (start_hour + sim_time / 3600.0) % 24.0
    lo = int(math.floor(hour)) % 24
    hi = (lo + 1) % 24
    frac = hour - math.floor(hour)
    return HOURLY_DEMAND[lo] * (1 - frac) + HOURLY_DEMAND[hi] * frac


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
