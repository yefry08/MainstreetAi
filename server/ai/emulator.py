"""
AI traffic emulation: natural language in, structured scenario events out.

The demo currently has three hand-written scenarios (Camp Nou, metro failure,
rain). This turns that into an open-ended input: type "a cruise ship docks and
four thousand people head for the Gothic Quarter in the rain" and get back
events the simulation can actually inject.

WHAT THIS DOES AND DOES NOT DO — worth being precise, because the difference
matters for how honestly the demo can be pitched:

  It does     translate an intent into structured, bounded parameters:
              where, how many vehicles, over what window, what weather.
  It does NOT invent traffic physics. Every event it emits is executed by SUMO
              against the real road network with real routing. The model
              chooses the scenario; the microsimulation decides what happens.

So the AI is a scenario author, not a traffic model. That distinction is what
keeps the "honest proof of concept" claim true: an LLM guessing at congestion
outcomes would be fabrication, whereas an LLM writing a plausible incident and
handing it to a validated simulator is just a better input device.

Injected vehicle counts are clamped: a scenario that asks for 90,000 cars gets
5,000 and a note saying so.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field

from .config import RoleConfig, emulator_config
from .providers import complete_json

# Landmarks the model can name. Every one is inside the simulated extract; the
# model is not permitted to invent coordinates, because a lat/lon it made up
# would silently land outside the network and inject nothing.
ANCHORS = {
    "camp_nou": (2.1228, 41.3809, "Camp Nou stadium"),
    "sagrada_familia": (2.1744, 41.4036, "Sagrada Família"),
    "placa_catalunya": (2.1700, 41.3870, "Plaça de Catalunya"),
    "placa_espanya": (2.1490, 41.3750, "Plaça d'Espanya"),
    "glories": (2.1866, 41.4038, "Glòries / Meridiana"),
    "diagonal_gracia": (2.1618, 41.3949, "Diagonal at Passeig de Gràcia"),
    "gran_via_centre": (2.1636, 41.3866, "Gran Via, central section"),
    "eixample_centre": (2.1655, 41.3915, "Eixample, central"),
}

CORRIDORS = ["diagonal", "gran_via", "meridiana"]

MAX_VEHICLES_PER_EVENT = 5000
MAX_EVENTS = 4

SCENARIO_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "Short name for the scenario."},
        "summary": {
            "type": "string",
            "description": "One or two sentences a presenter can read aloud.",
        },
        "events": {
            "type": "array",
            "description": "Up to 4 events, ordered by when they start.",
            "items": {
                "type": "object",
                "properties": {
                    "kind": {
                        "type": "string",
                        "enum": ["surge", "corridor_surge", "rain", "clear_weather"],
                        "description": "surge injects vehicles around an anchor; "
                                       "corridor_surge loads a named corridor; "
                                       "rain/clear_weather change driving conditions.",
                    },
                    # The sentinel is the string "none", not "". Gemini's
                    # responseSchema rejects an empty string as an enum member
                    # outright (400), and every provider here has to accept the
                    # same schema.
                    "anchor": {
                        "type": "string",
                        "enum": list(ANCHORS.keys()) + ["none"],
                        "description": "Required for surge. Use \"none\" otherwise.",
                    },
                    "corridor": {
                        "type": "string",
                        "enum": CORRIDORS + ["none"],
                        "description": "Required for corridor_surge. Use \"none\" otherwise.",
                    },
                    "vehicles": {
                        "type": "integer",
                        "description": "Extra vehicles for surge events, 0 for weather. "
                                       "Realistic range 200-2000.",
                    },
                    "radius_m": {
                        "type": "integer",
                        "description": "Spread around the anchor in metres, 200-1500.",
                    },
                    "over_minutes": {
                        "type": "integer",
                        "description": "Simulated minutes to spread departures over, 1-30.",
                    },
                    "delay_minutes": {
                        "type": "integer",
                        "description": "Simulated minutes from now until this starts, 0-30.",
                    },
                    "note": {
                        "type": "string",
                        "description": "One short line shown in the demo event ticker.",
                    },
                },
                "required": ["kind", "anchor", "corridor", "vehicles",
                             "radius_m", "over_minutes", "delay_minutes", "note"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["title", "summary", "events"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = f"""\
You turn a described situation into traffic events for a microsimulation of \
central Barcelona.

You are choosing WHAT HAPPENS AND WHERE. You are not predicting the traffic \
outcome — SUMO simulates that against the real street network, with real routing \
and real signal timing. Your job is a plausible, well-scoped incident.

Anchors you may use (nothing else exists in the simulated area):
{chr(10).join(f"  {k} — {v[2]}" for k, v in ANCHORS.items())}

Corridors: {", ".join(CORRIDORS)}

Scale guidance, from the simulation's own numbers:
- The whole extract carries roughly 2,000-2,500 vehicles at morning peak.
- A football crowd leaving Camp Nou is about 800-1200 extra cars over 10-15 min.
- A metro line failure pushes roughly 400-800 trips onto the roads it parallels.
- An event of 3000+ vehicles will gridlock the network. Only do that if the \
description clearly calls for something catastrophic.

Rain is a real behavioural change, not a number: it lowers speeds, lengthens \
headways and takes some cyclists off the road. Add it when the description \
mentions weather.

Prefer two or three well-chosen events over four vague ones. Every note should \
read like something a traffic controller would actually write."""


@dataclass
class Scenario:
    title: str
    summary: str
    events: list = field(default_factory=list)
    source: str = "ai"
    latency_ms: float = 0.0
    warnings: list = field(default_factory=list)
    error: str | None = None
    provider: str | None = None
    model: str | None = None

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "summary": self.summary,
            "events": self.events,
            "source": self.source,
            "latency_ms": round(self.latency_ms, 1),
            "warnings": self.warnings,
            "error": self.error,
            "provider": self.provider,
            "model": self.model,
        }


def sanitise(raw: dict) -> tuple[list, list]:
    """Clamp everything the model returned into what the simulation can execute."""
    warnings: list[str] = []
    out: list[dict] = []

    for ev in (raw.get("events") or [])[:MAX_EVENTS]:
        kind = ev.get("kind")
        if kind not in ("surge", "corridor_surge", "rain", "clear_weather"):
            warnings.append(f"dropped unknown event kind {kind!r}")
            continue

        clean = {
            "kind": kind,
            "note": str(ev.get("note", ""))[:140],
            "delay_minutes": max(0, min(30, int(ev.get("delay_minutes", 0) or 0))),
        }

        if kind in ("surge", "corridor_surge"):
            n = int(ev.get("vehicles", 0) or 0)
            if n > MAX_VEHICLES_PER_EVENT:
                warnings.append(
                    f"{kind}: {n} vehicles clamped to {MAX_VEHICLES_PER_EVENT}"
                )
                n = MAX_VEHICLES_PER_EVENT
            clean["vehicles"] = max(0, n)
            clean["over_minutes"] = max(1, min(30, int(ev.get("over_minutes", 10) or 10)))

        if kind == "surge":
            anchor = (ev.get("anchor") or "").strip()
            if anchor not in ANCHORS:
                warnings.append(f"surge: unknown anchor {anchor!r}, dropped")
                continue
            lon, lat, label = ANCHORS[anchor]
            clean["anchor"] = anchor
            clean["center"] = [lon, lat]
            clean["label"] = label
            clean["radius_m"] = max(200, min(1500, int(ev.get("radius_m", 700) or 700)))

        if kind == "corridor_surge":
            corridor = (ev.get("corridor") or "").strip()
            if corridor not in CORRIDORS:
                warnings.append(f"corridor_surge: unknown corridor {corridor!r}, dropped")
                continue
            clean["corridor"] = corridor

        out.append(clean)

    return out, warnings


class Emulator:
    """Natural-language scenario author. Inert without a key."""

    def __init__(self, cfg: RoleConfig | None = None):
        self.cfg = cfg or emulator_config()

    @property
    def available(self) -> bool:
        return self.cfg.enabled

    def compose(self, description: str, state: dict | None = None) -> Scenario:
        if not self.available:
            return Scenario(
                title="Emulator not configured",
                summary="Set MAINSTREET_EMULATOR_KEY to generate scenarios from "
                        "a description. The three built-in scenarios still work.",
                source="unavailable",
            )

        t0 = time.perf_counter()
        try:
            context = ""
            if state:
                m = state.get("metrics", {}) or {}
                context = (
                    f"\n\nCurrent simulation state: {state.get('clock', '??:??')}, "
                    f"{m.get('running', 0)} vehicles running, "
                    f"{m.get('halting', 0)} queued, "
                    f"mean speed {m.get('mean_speed_kmh', 0)} km/h. "
                    "Scale the scenario relative to this."
                )

            raw, meta = complete_json(
                self.cfg.provider,
                self.cfg.api_key,
                self.cfg.chain,
                system=SYSTEM_PROMPT,
                user=f"Scenario to stage:\n{description.strip()}{context}",
                schema=SCENARIO_SCHEMA,
                max_tokens=3000,
                # Longer than the orchestrator's: this is user-initiated and
                # someone is watching it, so waiting beats failing.
                timeout=60.0,
            )

            events, warnings = sanitise(raw)
            return Scenario(
                title=str(raw.get("title", "Scenario"))[:80],
                summary=str(raw.get("summary", ""))[:400],
                events=events,
                latency_ms=meta.get("latency_ms", (time.perf_counter() - t0) * 1000),
                warnings=warnings,
                provider=meta.get("provider"),
                model=meta.get("model"),
            )

        except Exception as exc:  # noqa: BLE001
            return Scenario(
                title="Scenario generation failed",
                summary="The built-in scenarios are unaffected.",
                source="error",
                latency_ms=(time.perf_counter() - t0) * 1000,
                error=f"{type(exc).__name__}: {exc}"[:200],
                provider=self.cfg.provider,
                model=self.cfg.model,
            )
