"""
AI orchestration layer: an LLM sets signal POLICY, rules execute it.

THE ARCHITECTURAL DECISION, because it is the one that matters:

An LLM cannot drive 1,151 junctions at 1 Hz. That is ~69,000 decisions a
minute, each needing sub-second latency, and it would be both ruinously
expensive and far too slow. Anyone claiming otherwise has not counted.

So control is split into two layers:

  STRATEGIC  (this file, LLM, every ~60 simulated seconds)
             Reads aggregate network state — corridor flow, queue totals, bus
             delay, active events, time of day — and returns a small set of
             POLICY PARAMETERS plus a one-line rationale.

  TACTICAL   (controllers.AdaptiveController, deterministic, 1 Hz)
             Executes those parameters at every junction, every second.

This is not a compromise to save money; it is how a deployable system would be
built. The safety-critical timing stays in auditable rules, and the layer that
can be wrong in surprising ways never touches a signal directly — it can only
move parameters inside bounds this file enforces.

Which leads to the second decision: EVERY VALUE IS CLAMPED IN CODE. The model
cannot set a minimum green below the pedestrian clearance interval no matter
what it returns, because `POLICY_BOUNDS` is applied after parsing, not
requested in the prompt. A prompt is a preference. A clamp is a guarantee.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field

from .config import RoleConfig, orchestrator_config

# Hard bounds. The model proposes; these dispose.
# min_green's floor is the pedestrian clearance interval — a person already in
# the crossing when the phase started has to be able to finish it.
POLICY_BOUNDS = {
    "min_green": (6.0, 20.0),
    "max_green_base": (25.0, 90.0),
    "imbalance": (1.0, 2.0),
    "bus_detect_m": (60.0, 220.0),
    "tsp_max_green": (30.0, 110.0),
}

# What the deterministic controller runs when no AI is configured. Identical to
# AdaptiveController's own defaults, so "AI off" is exactly the validated
# rules-based policy rather than some other thing.
DEFAULT_POLICY = {
    "min_green": 8.0,
    "max_green_base": 55.0,
    "imbalance": 1.15,
    "bus_detect_m": 140.0,
    "tsp_max_green": 70.0,
}

POLICY_SCHEMA = {
    "type": "object",
    "properties": {
        "min_green": {
            "type": "number",
            "description": "Seconds of green that can never be truncated, 6-20.",
        },
        "max_green_base": {
            "type": "number",
            "description": "Base fairness cap on green time before forcing a "
                           "phase change, 25-90 s. Scaled by time-of-day demand.",
        },
        "imbalance": {
            "type": "number",
            "description": "How much the served queue must exceed the waiting "
                           "queue to hold green. 1.0 holds readily, 2.0 is "
                           "reluctant. Range 1.0-2.0.",
        },
        "bus_detect_m": {
            "type": "number",
            "description": "Metres before the stop line at which an approaching "
                           "bus requests priority, 60-220.",
        },
        "tsp_max_green": {
            "type": "number",
            "description": "Longest green a bus priority request may hold, 30-110 s.",
        },
        "rationale": {
            "type": "string",
            "description": "One sentence, plain language, naming the evidence "
                           "that drove the change. Shown in the demo UI.",
        },
    },
    "required": [
        "min_green", "max_green_base", "imbalance",
        "bus_detect_m", "tsp_max_green", "rationale",
    ],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """\
You set traffic-signal policy for central Barcelona. A deterministic controller \
executes your parameters at 1,151 junctions every second; you are the strategic \
layer above it and you are called roughly once a simulated minute.

You do not control individual junctions or phases. You return five numbers that \
change how the controller behaves everywhere, and one sentence explaining why.

The objectives, in priority order:
1. Do not starve any approach. A fairness cap that is too high buys arterial \
throughput by abandoning side streets; the p95 and worst-case waits are how \
that shows up.
2. Move buses. A bus carries around eighty people; the cars queued behind it \
carry roughly eight. Transit delay is weighted accordingly.
3. Reduce total time spent stationary, which is what drives both congestion and \
emissions.

How the parameters behave:
- Raising max_green_base serves long platoons on busy corridors but lengthens \
cross-street waits. Raise it under heavy load, lower it when the network is light.
- Raising imbalance makes the controller quicker to switch away, which helps \
side streets and hurts arterial throughput.
- Widening bus_detect_m grants priority earlier, which helps buses and costs \
cross traffic. Widen it when transit delay is high.
- min_green is a safety floor. Only raise it; never propose a reduction to buy \
throughput.

You will be given the current network state and the recent effect of your last \
change. Prefer small adjustments — large swings make the network oscillate, and \
the effect of a change takes a few minutes to appear. If the state looks healthy, \
return the current values unchanged and say so."""


@dataclass
class PolicyDecision:
    """One strategic decision, plus enough provenance to show in the UI."""

    policy: dict
    rationale: str
    source: str            # "ai" | "default" | "fallback"
    at_sim_time: float = 0.0
    latency_ms: float = 0.0
    clamped: list = field(default_factory=list)
    error: str | None = None

    def to_dict(self) -> dict:
        return {
            "policy": self.policy,
            "rationale": self.rationale,
            "source": self.source,
            "at_sim_time": round(self.at_sim_time, 1),
            "latency_ms": round(self.latency_ms, 1),
            "clamped": self.clamped,
            "error": self.error,
        }


def clamp_policy(raw: dict) -> tuple[dict, list]:
    """Force every value inside its bound. Returns (policy, names_clamped)."""
    out, clamped = {}, []
    for key, (lo, hi) in POLICY_BOUNDS.items():
        try:
            v = float(raw.get(key, DEFAULT_POLICY[key]))
        except (TypeError, ValueError):
            v = DEFAULT_POLICY[key]
            clamped.append(key)
            out[key] = v
            continue
        c = max(lo, min(hi, v))
        if abs(c - v) > 1e-9:
            clamped.append(key)
        out[key] = c
    return out, clamped


class Orchestrator:
    """
    Strategic signal policy.

    Safe to construct with no API key: `decide()` then returns the validated
    rules-based defaults, and the simulation runs exactly as it does today.
    """

    def __init__(self, cfg: RoleConfig | None = None, interval_s: float = 60.0):
        self.cfg = cfg or orchestrator_config()
        self.interval_s = interval_s
        self._client = None
        self._last_at = -1e9
        self.current = PolicyDecision(
            policy=dict(DEFAULT_POLICY),
            rationale="Deterministic rules-based policy; no orchestration key configured.",
            source="default",
        )
        self.history: list[dict] = []

    # -----------------------------------------------------------------
    @property
    def available(self) -> bool:
        return self.cfg.enabled

    def _lazy_client(self):
        if self._client is None:
            import anthropic
            self._client = anthropic.Anthropic(
                api_key=self.cfg.api_key,
                # The control loop must never stall on a slow API call: the
                # tactical layer keeps running the previous policy, so a
                # timeout is a non-event.
                timeout=20.0,
                max_retries=1,
            )
        return self._client

    def due(self, sim_time: float) -> bool:
        return self.available and (sim_time - self._last_at) >= self.interval_s

    # -----------------------------------------------------------------
    def decide(self, sim_time: float, state: dict) -> PolicyDecision:
        """
        Ask for a policy update. Returns the previous decision unchanged on any
        failure — a signal network must not change behaviour because an HTTP
        call failed.
        """
        if not self.available:
            return self.current

        self._last_at = sim_time
        t0 = time.perf_counter()

        try:
            import anthropic
        except ImportError:
            self.current = PolicyDecision(
                policy=dict(DEFAULT_POLICY),
                rationale="anthropic SDK not installed; running rules-based defaults.",
                source="fallback",
                at_sim_time=sim_time,
                error="anthropic package missing",
            )
            return self.current

        try:
            client = self._lazy_client()
            response = client.messages.create(
                model=self.cfg.model,
                max_tokens=2000,
                system=SYSTEM_PROMPT,
                # Strategy over a dozen interacting metrics is exactly the kind
                # of multi-factor judgement adaptive thinking is for. Effort is
                # held at medium because this runs on a timer, forever, and the
                # decision is five bounded numbers rather than a research task.
                thinking={"type": "adaptive"},
                output_config={
                    "effort": "medium",
                    "format": {"type": "json_schema", "schema": POLICY_SCHEMA},
                },
                messages=[{"role": "user", "content": _render_state(sim_time, state, self.current)}],
            )

            text = next((b.text for b in response.content if b.type == "text"), None)
            if not text:
                raise ValueError("no text block in response")
            raw = json.loads(text)

            policy, clamped = clamp_policy(raw)
            self.current = PolicyDecision(
                policy=policy,
                rationale=str(raw.get("rationale", "")).strip()[:240],
                source="ai",
                at_sim_time=sim_time,
                latency_ms=(time.perf_counter() - t0) * 1000,
                clamped=clamped,
            )

        except Exception as exc:  # noqa: BLE001 - never let control depend on the network
            prev = self.current
            self.current = PolicyDecision(
                policy=prev.policy,
                rationale=prev.rationale,
                source="fallback",
                at_sim_time=sim_time,
                latency_ms=(time.perf_counter() - t0) * 1000,
                error=f"{type(exc).__name__}: {exc}"[:200],
            )

        self.history.append(self.current.to_dict())
        del self.history[:-20]
        return self.current


def _render_state(sim_time: float, state: dict, previous: PolicyDecision) -> str:
    """
    Compact, stable state rendering.

    Deliberately terse and ordered: this prompt is sent on a timer for the life
    of the run, and a stable prefix is what makes prompt caching work. Anything
    volatile (the clock, the metrics) goes at the end.
    """
    m = state.get("metrics", {}) or {}
    corridors = state.get("corridors", {}) or {}
    events = state.get("events", []) or []

    lines = [
        "CURRENT POLICY",
        json.dumps(previous.policy, sort_keys=True),
        f"last change: {previous.source} at t={previous.at_sim_time:.0f}s"
        f" — {previous.rationale or 'n/a'}",
        "",
        f"NETWORK STATE at {state.get('clock', '??:??')} (t={sim_time:.0f}s)",
        f"  vehicles running        {m.get('running', 0)}",
        f"  queued right now        {m.get('halting', 0)}",
        f"  mean speed              {m.get('mean_speed_kmh', 0)} km/h",
        f"  bus mean speed          {m.get('bus_mean_speed_kmh', 0)} km/h",
        f"  bus hours lost stopped  {m.get('bus_stopped_hours', 0)}",
        f"  veh-hours lost stopped  {m.get('stopped_veh_hours', 0)}",
        f"  p95 wait                {m.get('p95_wait_s', 0)} s",
        f"  worst wait              {m.get('max_wait_s', 0)} s",
        f"  waiting over 5 min      {m.get('stranded', 0)}",
        f"  trips completed         {m.get('completed', 0)}",
    ]

    if corridors:
        lines.append("")
        lines.append("CORRIDOR FLOW INDEX (1.0 = free flow, vehicle-weighted)")
        for name in sorted(corridors):
            c = corridors[name] or {}
            lines.append(
                f"  {name:<12} flow {c.get('flow', 0):.2f}"
                f"  {c.get('kmh', 0):.1f} km/h  {c.get('veh', 0)} veh"
            )

    if events:
        lines.append("")
        lines.append("ACTIVE SCENARIO EVENTS")
        for e in events[-4:]:
            lines.append(f"  t={e.get('t', 0):.0f}s {e.get('kind', '?')}: {e.get('note', '')}")

    lines.append("")
    lines.append("Return the five policy parameters and a one-sentence rationale.")
    return "\n".join(lines)
