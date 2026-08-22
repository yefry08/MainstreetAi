"""
Live Barcelona weather from Open-Meteo.

*** REAL DATA ***
api.open-meteo.com — free, no key, no registration, CC-BY. It is the rare case
where the honest answer to "can we use a real API for this?" is simply yes.

Why it belongs in a traffic simulation rather than being decoration: rain is a
genuine change in driving behaviour, not a graphic. Wet roads mean lower speeds,
longer headways, weaker braking, and a measurable share of cyclists staying
home. The simulation already models all of that — this just means the weather
driving it is Barcelona's actual weather instead of a button someone pressed.

Fails soft in every direction: no network, no problem. The simulation runs with
dry-road behaviour and the UI says the feed is unavailable rather than
inventing a forecast.
"""

from __future__ import annotations

import threading
import time

import requests

LAT, LON = 41.3874, 2.1686  # Plaça de Catalunya

URL = (
    "https://api.open-meteo.com/v1/forecast"
    f"?latitude={LAT}&longitude={LON}"
    "&current=temperature_2m,relative_humidity_2m,precipitation,"
    "weather_code,wind_speed_10m,is_day"
    "&hourly=precipitation_probability"
    "&timezone=Europe/Madrid&forecast_days=1"
)

# WMO weather codes, grouped by what they do to traffic rather than by how they
# look out of a window. Drizzle and heavy rain are different driving conditions;
# "partly cloudy" and "clear" are not.
WMO = {
    0: ("Clear", "clear"), 1: ("Mainly clear", "clear"),
    2: ("Partly cloudy", "clear"), 3: ("Overcast", "clear"),
    45: ("Fog", "fog"), 48: ("Rime fog", "fog"),
    51: ("Light drizzle", "drizzle"), 53: ("Drizzle", "drizzle"),
    55: ("Heavy drizzle", "drizzle"),
    61: ("Light rain", "rain"), 63: ("Rain", "rain"), 65: ("Heavy rain", "heavy"),
    66: ("Freezing rain", "heavy"), 67: ("Freezing rain", "heavy"),
    71: ("Light snow", "heavy"), 73: ("Snow", "heavy"), 75: ("Heavy snow", "heavy"),
    80: ("Rain showers", "rain"), 81: ("Rain showers", "rain"),
    82: ("Violent showers", "heavy"),
    95: ("Thunderstorm", "heavy"), 96: ("Thunderstorm", "heavy"),
    99: ("Thunderstorm", "heavy"),
}

# How each condition changes driving. These are the same levers the manual rain
# scenario already used, so live weather and the demo button drive the
# simulation through exactly one code path.
CONDITION_EFFECT = {
    "clear":   {"speed_factor": 1.00, "tau": 1.10, "decel": 4.5, "bike_factor": 1.00},
    "fog":     {"speed_factor": 0.82, "tau": 1.45, "decel": 4.0, "bike_factor": 0.85},
    "drizzle": {"speed_factor": 0.90, "tau": 1.30, "decel": 4.0, "bike_factor": 0.85},
    "rain":    {"speed_factor": 0.78, "tau": 1.60, "decel": 3.4, "bike_factor": 0.72},
    "heavy":   {"speed_factor": 0.68, "tau": 1.85, "decel": 3.0, "bike_factor": 0.45},
}


class WeatherFeed:
    """Polls Open-Meteo on a background thread. Never blocks the simulation."""

    def __init__(self, interval_s: float = 600.0):
        self.interval_s = interval_s
        self._lock = threading.Lock()
        self._state: dict = {
            "available": False,
            "condition": "clear",
            "label": "unknown",
            "note": "not fetched yet",
        }
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # -----------------------------------------------------------------
    def start(self) -> None:
        if self._thread:
            return
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.is_set():
            self.refresh()
            # Barcelona weather does not change on a ten-second timescale, and
            # a free public API deserves not to be hammered.
            self._stop.wait(self.interval_s)

    # -----------------------------------------------------------------
    def refresh(self) -> dict:
        try:
            r = requests.get(URL, timeout=15,
                             headers={"User-Agent": "mainstreetai/1.0"})
            r.raise_for_status()
            d = r.json()
            cur = d.get("current") or {}
            code = int(cur.get("weather_code", 0))
            label, condition = WMO.get(code, ("Unknown", "clear"))

            state = {
                "available": True,
                "condition": condition,
                "label": label,
                "wmo_code": code,
                "temperature_c": cur.get("temperature_2m"),
                "humidity_pct": cur.get("relative_humidity_2m"),
                "precipitation_mm": cur.get("precipitation"),
                "wind_kmh": cur.get("wind_speed_10m"),
                "is_day": bool(cur.get("is_day", 1)),
                "observed_at": cur.get("time"),
                "effect": CONDITION_EFFECT[condition],
                "source": "Open-Meteo (real, live)",
                "fetched_at": time.time(),
                "note": None,
            }
        except Exception as exc:  # noqa: BLE001
            state = {
                # Explicitly NOT a made-up forecast. The simulation runs dry and
                # the UI says so.
                "available": False,
                "condition": "clear",
                "label": "unavailable",
                "effect": CONDITION_EFFECT["clear"],
                "source": "Open-Meteo (unreachable)",
                "fetched_at": time.time(),
                "note": f"{type(exc).__name__}: {exc}"[:140],
            }

        with self._lock:
            self._state = state
        return state

    # -----------------------------------------------------------------
    @property
    def state(self) -> dict:
        with self._lock:
            return dict(self._state)

    @property
    def condition(self) -> str:
        with self._lock:
            return self._state.get("condition", "clear")
