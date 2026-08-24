"""
Live external data feeds, with honest provenance.

THE RULE THIS FILE EXISTS TO ENFORCE
------------------------------------
The demo makes claims about Barcelona. Every number on screen is either
measured, simulated, or absent -- never invented and never quietly upgraded
from "simulated" to "real" because a feed happens to be configured. So each
feed carries an explicit status that the UI can show:

    not_configured   no key/URL supplied; the simulation runs as normal
    ok               fetched successfully, `fetched_at` says when
    stale            last fetch failed; serving a cached value, with its age
    error            no usable data at all

There is deliberately NO default endpoint. A URL invented here would be a
fabricated data source with a plausible-looking name, which is exactly the
failure mode to avoid: it would look like it worked. Both the key and the URL
must come from the environment.

ONE FEED IS ALREADY LIVE AND NEEDS NO KEY

    bcn_traffic   Open Data BCN publishes the current congestion state of 532
                  instrumented city sections, refreshed every few minutes,
                  CC BY 4.0, no registration. It is on by default because it
                  has been verified against the live endpoint -- see
                  feeds/bcn.py. That is the difference between a default URL
                  and an invented one.

CONFIGURATION (in .env, which is gitignored -- see .env.example)

    MAINSTREET_TRAFFIC_API_KEY     Feed A: Barcelona traffic control
    MAINSTREET_TRAFFIC_API_URL
    MAINSTREET_TRAFFIC_API_AUTH    header | bearer | query   (default: header)
    MAINSTREET_TRAFFIC_API_PARAM   header or query-param name

    MAINSTREET_VEHICLE_API_KEY     Feed B: vehicle data
    MAINSTREET_VEHICLE_API_URL
    MAINSTREET_VEHICLE_API_AUTH
    MAINSTREET_VEHICLE_API_PARAM

To find out what an endpoint actually returns before writing any parsing
against it:

    python server/feeds/inspect.py traffic
"""

from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass
from typing import Any

import requests

from . import bcn

# Reuse the .env loader the AI layer already has, so there is one way to put a
# secret into this process rather than two.
try:
    from ..ai.config import _load_dotenv  # noqa: F401  (import runs the loader)
except Exception:  # pragma: no cover - the AI layer is optional
    pass


# How long a successful response stays fresh. Traffic control feeds publish on
# the order of minutes; polling faster burns quota to redraw identical data.
DEFAULT_TTL_S = 60.0

# A stale value is still worth showing -- with its age -- up to this point.
# Past it the feed is reported as an error rather than silently serving
# yesterday's congestion as though it were live.
MAX_STALE_S = 900.0

REQUEST_TIMEOUT_S = 8.0


@dataclass
class FeedConfig:
    """One external feed, configured entirely from the environment."""

    name: str
    label: str
    env_prefix: str
    ttl_s: float = DEFAULT_TTL_S

    # A published, verified endpoint may be the default. The "no default URL"
    # rule above is about not INVENTING a plausible-looking source; it is not
    # about refusing to ship one that has been confirmed to work. Anything set
    # here must have been fetched and checked, and named in the README.
    default_url: str | None = None

    # Some sources need no credential at all -- Open Data BCN is public. Such
    # a feed is fully configured with a URL alone, and demanding a key it does
    # not have would report a working live source as "simulated".
    keyless: bool = False

    # Turns the raw body into the shape the app consumes. Kept beside the
    # config so a feed cannot be added without someone deciding what its
    # payload actually means.
    parser: Any = None

    # Where the data came from, shown in the provenance panel.
    attribution: str | None = None

    @property
    def key(self) -> str | None:
        return os.environ.get(f"{self.env_prefix}_KEY") or None

    @property
    def url(self) -> str | None:
        return os.environ.get(f"{self.env_prefix}_URL") or self.default_url

    @property
    def auth_style(self) -> str:
        return (os.environ.get(f"{self.env_prefix}_AUTH") or "header").lower()

    @property
    def auth_param(self) -> str:
        # A sensible default per style, overridable. Most public-sector APIs
        # use a bare `api_key` query param or an `X-API-Key` header.
        default = "api_key" if self.auth_style == "query" else "X-API-Key"
        return os.environ.get(f"{self.env_prefix}_PARAM") or default

    @property
    def configured(self) -> bool:
        """
        A URL is always required; a key only for feeds that use one. A key
        with no URL cannot fetch anything, so it does not count as configured.
        """
        if not self.url:
            return False
        return True if self.keyless else bool(self.key)


@dataclass
class FeedResult:
    name: str
    status: str                    # not_configured | ok | stale | error
    data: Any = None
    fetched_at: float | None = None
    age_s: float | None = None
    error: str | None = None
    http_status: int | None = None
    elapsed_ms: float | None = None

    def public(self) -> dict:
        """What the UI is allowed to see. Never includes the credential."""
        return {
            "name": self.name,
            "status": self.status,
            "fetched_at": self.fetched_at,
            "age_s": None if self.age_s is None else round(self.age_s, 1),
            "error": self.error,
            "http_status": self.http_status,
            "elapsed_ms": self.elapsed_ms,
        }


FEEDS: dict[str, FeedConfig] = {
    # Real, live, keyless. The city republishes the current congestion state
    # of 532 instrumented sections every few minutes. This is the one feed in
    # this table that is switched on by default, because it needs nothing from
    # the operator and has been verified against the live endpoint.
    "bcn_traffic": FeedConfig(
        name="bcn_traffic",
        label="Barcelona live traffic (Open Data BCN)",
        env_prefix="MAINSTREET_BCN_TRAFFIC",
        default_url=bcn.TRAMS_LIVE_URL,
        keyless=True,
        parser=bcn.parse_trams,
        attribution=bcn.ATTRIBUTION,
        # The source refreshes every few minutes; polling faster only burns
        # someone else's bandwidth to re-read the same numbers.
        ttl_s=180.0,
    ),
    "traffic": FeedConfig(
        name="traffic",
        label="Barcelona traffic control",
        env_prefix="MAINSTREET_TRAFFIC_API",
    ),
    "vehicle": FeedConfig(
        name="vehicle",
        label="Vehicle data",
        env_prefix="MAINSTREET_VEHICLE_API",
    ),
}


_cache: dict[str, FeedResult] = {}
_locks: dict[str, threading.Lock] = {n: threading.Lock() for n in FEEDS}


def _request(cfg: FeedConfig) -> tuple[Any, int, float]:
    """One HTTP GET. Raises on failure; the caller decides what that means."""
    headers: dict[str, str] = {"Accept": "application/json",
                               "User-Agent": "MainstreetAi/1.0"}
    params: dict[str, str] = {}

    if not cfg.keyless:
        style = cfg.auth_style
        if style == "bearer":
            headers["Authorization"] = f"Bearer {cfg.key}"
        elif style == "query":
            params[cfg.auth_param] = cfg.key or ""
        else:  # header
            headers[cfg.auth_param] = cfg.key or ""

    t0 = time.perf_counter()
    r = requests.get(cfg.url, headers=headers, params=params,
                     timeout=REQUEST_TIMEOUT_S)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    r.raise_for_status()

    if cfg.parser is not None:
        # A feed whose format has actually been looked at parses here, so the
        # rest of the app never sees a raw body.
        return cfg.parser(r.text), r.status_code, elapsed_ms

    ctype = (r.headers.get("Content-Type") or "").lower()
    if "json" in ctype:
        return r.json(), r.status_code, elapsed_ms
    # Not JSON: hand back text and let the inspector report what it really is,
    # rather than guessing at a parser for a format nobody has looked at yet.
    return r.text, r.status_code, elapsed_ms


def fetch(name: str, force: bool = False) -> FeedResult:
    """
    Fetch one feed, honouring its TTL.

    Never raises: a dead upstream must not be able to take the simulation with
    it. Failures come back as `stale` (cache still usable) or `error`.
    """
    cfg = FEEDS.get(name)
    if cfg is None:
        return FeedResult(name=name, status="error", error="unknown feed")

    if not cfg.configured:
        missing = []
        if not cfg.keyless and not cfg.key:
            missing.append(f"{cfg.env_prefix}_KEY")
        if not cfg.url:
            missing.append(f"{cfg.env_prefix}_URL")
        return FeedResult(name=name, status="not_configured",
                          error="missing: " + ", ".join(missing))

    now = time.time()
    with _locks[name]:
        cached = _cache.get(name)
        if (not force and cached and cached.status == "ok"
                and cached.fetched_at and now - cached.fetched_at < cfg.ttl_s):
            return FeedResult(**{**cached.__dict__,
                                 "age_s": now - cached.fetched_at})

        try:
            data, code, elapsed = _request(cfg)
        except Exception as exc:
            detail = f"{type(exc).__name__}: {exc}"[:200]
            if cached and cached.fetched_at and now - cached.fetched_at < MAX_STALE_S:
                return FeedResult(name=name, status="stale", data=cached.data,
                                  fetched_at=cached.fetched_at,
                                  age_s=now - cached.fetched_at, error=detail)
            return FeedResult(name=name, status="error", error=detail)

        res = FeedResult(name=name, status="ok", data=data, fetched_at=now,
                         age_s=0.0, http_status=code,
                         elapsed_ms=round(elapsed, 1))
        _cache[name] = res
        return res


def feed_status() -> dict:
    """
    Provenance summary for the UI, with no credentials in it.

    Reports what is CONFIGURED without hitting the network, so it is safe to
    call on every frame.
    """
    out = {}
    now = time.time()
    for name, cfg in FEEDS.items():
        cached = _cache.get(name)
        if not cfg.configured:
            out[name] = {"name": name, "label": cfg.label,
                         "status": "not_configured", "source": "simulated"}
            continue
        if cached and cached.fetched_at:
            age = now - cached.fetched_at
            status = cached.status
            if status == "ok" and age > cfg.ttl_s:
                status = "stale"
            out[name] = {"name": name, "label": cfg.label, "status": status,
                         "source": "live", "age_s": round(age, 1)}
        else:
            # Configured but never yet fetched. The source is NOT "live" —
            # nothing has come back from it, and labelling it live here would
            # put a live badge on screen for a feed that may turn out to be
            # unreachable. It becomes live on the first successful fetch.
            out[name] = {"name": name, "label": cfg.label,
                         "status": "configured", "source": "simulated"}
        if cfg.attribution:
            out[name]["attribution"] = cfg.attribution
    return out
