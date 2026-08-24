"""
Look at what a feed actually returns, before writing a line of parsing.

Run this the moment a key and URL land in .env. It reports the real shape of
the response -- keys, types, nesting, record counts, candidate coordinate and
timestamp fields -- so the integration is written against the payload rather
than against an assumption about it.

    python server/feeds/probe.py                # both feeds
    python server/feeds/probe.py traffic        # one
    python server/feeds/probe.py traffic --raw  # first 2 KB verbatim

(Named probe.py, not inspect.py: a module called `inspect` next to the script
being run shadows the standard library's, and `dataclasses` imports it. The
failure is a baffling ImportError several layers down.)

It never prints the credential. It prints the URL with any query-string key
redacted, so output is safe to paste into a chat.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from feeds.live import FEEDS, fetch  # noqa: E402

# Field names worth flagging: if a payload has these, it probably carries the
# thing we would want from it.
#
# Matched on TOKENS, not substrings. Naive `hint in name` tagged
# "notes_translated" as geographic (it contains "lat") and "frequency" as
# geographic too (it contains "y") -- noise precisely where the output needs
# to be trustworthy.
GEO_HINTS = ("lat", "lon", "lng", "longitude", "latitude", "coord", "coords",
             "coordinates", "geo", "geom", "geometry", "position", "point",
             "utm", "x", "y")
TIME_HINTS = ("time", "date", "timestamp", "updated", "hora", "data", "ts")
STATE_HINTS = ("state", "status", "estat", "estado", "phase", "signal", "light",
               "congest", "level", "flow", "speed", "count", "occupancy")


def _tokens(name: str) -> list[str]:
    out, cur = [], []
    for ch in name.lower():
        if ch.isalnum():
            cur.append(ch)
        elif cur:
            out.append("".join(cur))
            cur = []
    if cur:
        out.append("".join(cur))
    return out


def _matches(name: str, hints: tuple[str, ...]) -> bool:
    # Exact token match always counts. A prefix match counts only for hints
    # long enough to be meaningful, so "lat" still finds "latitude" while "x"
    # and "y" match only a field genuinely called x or y.
    for tok in _tokens(name):
        for h in hints:
            if tok == h or (len(h) >= 3 and tok.startswith(h)):
                return True
    return False


def _redact(url: str | None) -> str:
    if not url:
        return "(none)"
    for marker in ("api_key=", "apikey=", "key=", "token="):
        i = url.lower().find(marker)
        if i >= 0:
            end = url.find("&", i)
            tail = url[end:] if end > 0 else ""
            return url[:i + len(marker)] + "***" + tail
    return url


def _hits(name: str) -> str:
    tags = []
    if _matches(name, GEO_HINTS):
        tags.append("geo")
    if _matches(name, TIME_HINTS):
        tags.append("time")
    if _matches(name, STATE_HINTS):
        tags.append("state")
    return ("  <- " + ",".join(tags)) if tags else ""


def describe(value, indent: int = 2, depth: int = 0, max_depth: int = 4) -> None:
    pad = " " * indent
    if depth > max_depth:
        print(f"{pad}...")
        return

    if isinstance(value, dict):
        print(f"{pad}object with {len(value)} keys")
        for k, v in list(value.items())[:25]:
            t = type(v).__name__
            if isinstance(v, (dict, list)):
                n = len(v)
                print(f"{pad}  {k}: {t}[{n}]{_hits(k)}")
                if depth < max_depth:
                    describe(v, indent + 4, depth + 1, max_depth)
            else:
                s = repr(v)
                if len(s) > 60:
                    s = s[:57] + "..."
                print(f"{pad}  {k}: {t} = {s}{_hits(k)}")
        if len(value) > 25:
            print(f"{pad}  ... {len(value) - 25} more keys")

    elif isinstance(value, list):
        print(f"{pad}array of {len(value)}")
        if value:
            print(f"{pad}first element:")
            describe(value[0], indent + 2, depth + 1, max_depth)

    else:
        s = repr(value)
        print(f"{pad}{type(value).__name__} = {s[:200]}")


def report(name: str, raw: bool) -> int:
    cfg = FEEDS[name]
    print("=" * 72)
    print(f"FEED  {name}   ({cfg.label})")
    print("=" * 72)
    print(f"  env prefix : {cfg.env_prefix}")
    print(f"  key set    : {'yes' if cfg.key else 'NO'}")
    print(f"  url        : {_redact(cfg.url)}")
    print(f"  auth style : {cfg.auth_style}  (param: {cfg.auth_param})")

    if not cfg.configured:
        print("\n  NOT CONFIGURED — nothing to inspect.")
        print(f"  Set {cfg.env_prefix}_KEY and {cfg.env_prefix}_URL in .env")
        return 1

    print("\n  fetching...")
    res = fetch(name, force=True)
    print(f"  status     : {res.status}")
    print(f"  http       : {res.http_status}")
    print(f"  elapsed    : {res.elapsed_ms} ms")
    if res.error:
        print(f"  error      : {res.error}")
    if res.data is None:
        return 1

    if isinstance(res.data, str):
        print(f"\n  RESPONSE IS NOT JSON — {len(res.data)} characters of text.")
        print("  First 400 characters:\n")
        print("    " + res.data[:400].replace("\n", "\n    "))
        print("\n  Write the parser against this format, not against JSON.")
        return 0

    print("\n  SHAPE")
    describe(res.data)

    if raw:
        print("\n  RAW (first 2 KB)")
        print(json.dumps(res.data, indent=2, ensure_ascii=False)[:2048])

    # The two questions that decide how much of the simulation this replaces.
    print("\n  WHAT THIS CHANGES")
    blob = json.dumps(res.data, ensure_ascii=False).lower()
    has_geo = any(h in blob for h in ("lat", "lon", "coord", "geometry"))
    has_veh = any(h in blob for h in ("vehicle", "veh", "plate", "bus", "trip"))
    print(f"    carries coordinates : {'yes' if has_geo else 'no'}")
    print(f"    mentions vehicles   : {'yes' if has_veh else 'no'}")
    if name == "vehicle" and has_geo:
        print("    -> if these are LIVE POSITIONS, those points should be")
        print("       rendered directly rather than simulated. Simulation")
        print("       stays only for what the feed does not cover.")
    if name == "traffic":
        print("    -> if this carries measured congestion, it replaces the")
        print("       derived demand curve as ground truth for the baseline.")
    return 0


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    raw = "--raw" in sys.argv
    names = args or list(FEEDS)
    bad = 0
    for n in names:
        if n not in FEEDS:
            print(f"unknown feed {n!r}; known: {', '.join(FEEDS)}")
            bad += 1
            continue
        bad += report(n, raw)
        print()
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
