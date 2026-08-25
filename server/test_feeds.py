"""
Feed layer behaviour, with no network involved.

The feeds are the seam where "simulated" could quietly become "live" without
anyone noticing, so the invariants worth pinning are mostly about HONESTY
rather than plumbing:

  * an unconfigured feed says so, and never reports itself as live
  * a half-configured feed (key but no URL) is NOT treated as configured
  * a credential never leaves the process through the public surface
  * an upstream failure degrades to stale-with-an-age, then to error --
    it must never take the simulation down with it

Run:  python server/test_feeds.py
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import feeds.live as live  # noqa: E402

failures = 0


def check(name, ok, detail=""):
    global failures
    if not ok:
        failures += 1
    print(f"  {'ok  ' if ok else 'FAIL'} {name}{'   ' + detail if detail else ''}")


def clear_env(prefix):
    for suffix in ("KEY", "URL", "AUTH", "PARAM"):
        os.environ.pop(f"{prefix}_{suffix}", None)


PREFIX = "MAINSTREET_TRAFFIC_API"
cfg = live.FEEDS["traffic"]

# ---- unconfigured -------------------------------------------------------
clear_env(PREFIX)
live._cache.clear()
check("no key, no url -> not configured", not cfg.configured)

res = live.fetch("traffic")
check("unconfigured fetch reports not_configured", res.status == "not_configured",
      res.status)
check("unconfigured fetch names the missing vars",
      "KEY" in (res.error or "") and "URL" in (res.error or ""), res.error or "")

st = live.feed_status()["traffic"]
check("unconfigured status says simulated", st["source"] == "simulated", st["source"])

# ---- half configured ----------------------------------------------------
# A key with no URL is the easy mistake, and treating it as "configured"
# would mean the UI claims a live source that can never fetch anything.
os.environ[f"{PREFIX}_KEY"] = "secret-value-do-not-leak"
check("key without url is NOT configured", not cfg.configured)
st = live.feed_status()["traffic"]
check("half-configured still says simulated", st["source"] == "simulated", st["source"])

os.environ[f"{PREFIX}_URL"] = "http://127.0.0.1:9/never-listens"
check("key + url IS configured", cfg.configured)

# ---- the credential must not escape -------------------------------------
st = live.feed_status()["traffic"]
blob = repr(live.feed_status())
check("feed_status leaks no credential", "secret-value-do-not-leak" not in blob)

r = live.FeedResult(name="traffic", status="ok", data={"x": 1}, fetched_at=time.time())
check("FeedResult.public() drops the payload and any secret",
      "data" not in r.public() and "secret-value-do-not-leak" not in repr(r.public()))

# ---- upstream failure ---------------------------------------------------
# Port 9 is the discard port: nothing listens, so this fails fast without
# needing a mock HTTP server.
live._cache.clear()
res = live.fetch("traffic", force=True)
check("dead upstream returns error rather than raising", res.status == "error",
      res.status)
check("error carries a reason", bool(res.error), (res.error or "")[:60])

# ---- stale path ---------------------------------------------------------
# Seed the cache with a recent success, then fail: the feed should serve the
# cached value labelled stale, with its age.
live._cache["traffic"] = live.FeedResult(
    name="traffic", status="ok", data={"cached": True},
    fetched_at=time.time() - 5.0)
res = live.fetch("traffic", force=True)
check("recent cache + failure -> stale", res.status == "stale", res.status)
check("stale still serves the cached payload", res.data == {"cached": True})
check("stale reports an age", res.age_s is not None and res.age_s >= 5.0,
      str(res.age_s))

# Older than MAX_STALE_S: serving that as though it were live would be the
# actual fabrication, so it has to become an error.
live._cache["traffic"] = live.FeedResult(
    name="traffic", status="ok", data={"cached": True},
    fetched_at=time.time() - (live.MAX_STALE_S + 60))
res = live.fetch("traffic", force=True)
check("cache older than MAX_STALE_S -> error, not stale", res.status == "error",
      res.status)

# ---- auth styles --------------------------------------------------------
os.environ[f"{PREFIX}_AUTH"] = "query"
check("query auth defaults to api_key param", cfg.auth_param == "api_key",
      cfg.auth_param)
os.environ[f"{PREFIX}_AUTH"] = "header"
os.environ.pop(f"{PREFIX}_PARAM", None)
check("header auth defaults to X-API-Key", cfg.auth_param == "X-API-Key",
      cfg.auth_param)
os.environ[f"{PREFIX}_PARAM"] = "Authorization-Custom"
check("param is overridable", cfg.auth_param == "Authorization-Custom",
      cfg.auth_param)

# ---- unknown feed -------------------------------------------------------
res = live.fetch("does-not-exist")
check("unknown feed errors cleanly", res.status == "error", res.status)

# ---- Open Data BCN parser (offline, fixed sample) -----------------------
import feeds.bcn as bcn  # noqa: E402
from datetime import datetime  # noqa: E402

SAMPLE = "\n".join([
    "1#20260824195056#3#2",
    "2#20260824195056#0#0",     # detector down
    "3#20260824195056#6#6",     # blocked
    "4#20260824195056#4#3",     # very dense -> counts as congested
    "5#20260824195056#1#1",
    "garbage line",             # must be counted, not crash
    "6#notadate#2#2",           # unparseable timestamp
    "",
])
p = bcn.parse_trams(SAMPLE)
check("parses the good rows", p["sections_total"] == 5, str(p["sections_total"]))
check("counts malformed rows", p["malformed_rows"] == 2, str(p["malformed_rows"]))

# State 0 means the detector is DOWN, not "clear". Counting it as reporting
# would dilute every percentage with sections that measured nothing.
check("state 0 excluded from reporting", p["sections_reporting"] == 4,
      str(p["sections_reporting"]))
check("congested counts >=4 only", p["congested"] == 2, str(p["congested"]))
check("congested_pct uses reporting as denominator",
      p["congested_pct"] == 50.0, str(p["congested_pct"]))

# Barcelona local time, not naive. Parsed naively this reads as the future.
check("timestamp carries a Barcelona offset",
      p["observed_at"].endswith("+02:00"), p["observed_at"])
check("age is positive", p["age_s"] is not None and p["age_s"] > 0,
      str(p["age_s"]))

# The DST fallback must match the real database, or freshness drifts an hour.
summer = datetime(2026, 8, 24, 19, 50, 56)
winter = datetime(2026, 1, 15, 12, 0, 0)
if bcn.BCN_TZ is not None:
    check("DST fallback matches IANA (summer)",
          summer.replace(tzinfo=bcn.BCN_TZ).utcoffset()
          == summer.replace(tzinfo=bcn._madrid_offset(summer)).utcoffset())
    check("DST fallback matches IANA (winter)",
          winter.replace(tzinfo=bcn.BCN_TZ).utcoffset()
          == winter.replace(tzinfo=bcn._madrid_offset(winter)).utcoffset())

check("empty body does not crash", bcn.parse_trams("")["sections_total"] == 0)

# Coverage: 4 of 5 sections reporting is plenty; the flag must stay off.
check("healthy coverage is not flagged", p["low_coverage"] is False,
      f"{p['coverage_pct']}%")

# Overnight the city goes dark -- measured at 05:00, 447 of 532 sections
# reported nothing. The percentage is still arithmetically right but rests on
# far too few detectors to state as a firm measurement.
DARK = "\n".join([f"{i}#20260825050052#0#0" for i in range(1, 91)]
                 + [f"{i}#20260825050052#5#5" for i in range(91, 101)])
d = bcn.parse_trams(DARK)
check("mostly-dark network is flagged low coverage", d["low_coverage"] is True,
      f"{d['coverage_pct']}% reporting")
check("coverage_pct is share of TOTAL, not of reporting",
      d["coverage_pct"] == 10.0, str(d["coverage_pct"]))
check("congested_pct still uses reporting as denominator",
      d["congested_pct"] == 100.0, str(d["congested_pct"]))
check("summary drops the per-section payload",
      "sections" not in bcn.summary(p) and "counts" in bcn.summary(p))

# The live feed needs no key, and must not report itself unconfigured.
cfg_bcn = live.FEEDS["bcn_traffic"]
check("keyless feed is configured with no key", cfg_bcn.configured)
check("keyless feed has a real default URL",
      (cfg_bcn.url or "").startswith("https://opendata-ajuntament.barcelona.cat"))

clear_env(PREFIX)
live._cache.clear()

print(f"\n{failures} FAILED" if failures else "\nall passed")
sys.exit(1 if failures else 0)
