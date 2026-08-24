"""
Live traffic state for Barcelona, from Open Data BCN.

This is the real thing: the city publishes the current congestion state of 532
instrumented street sections, overwritten in place every few minutes. No key,
no registration, CC BY 4.0.

    https://opendata-ajuntament.barcelona.cat/data/dataset/trams

The `trams` dataset holds one live file (TRAMS_TRAMS.dat) alongside years of
monthly CSV archives. Only the .dat is current -- the newest monthly CSV is
last month's, so pointing at one of those would produce a plausible-looking
"live" panel showing traffic from weeks ago. The CKAN metadata is no help
here either: it reports the live file's last_modified as 2023, because the
file is overwritten rather than replaced.

FORMAT  one record per line, '#' separated, no header:

    idTram # yyyyMMddHHmmss # estatActual # estatPrevist
    1#20260824195056#3#2

TIMESTAMPS ARE BARCELONA LOCAL TIME, with no offset marker. Parsed naively on
a machine in another zone they read as hours in the future, which looks like a
clock bug and would make a freshness check reject good data -- or, worse,
accept stale data. They are pinned to Europe/Madrid here.

STATE SCALE (both current and 15-minute forecast):

    0  no data        the section's detector is not reporting
    1  very fluid
    2  fluid
    3  dense
    4  very dense
    5  congested
    6  blocked

0 means ABSENT, not "clear", and averaging it in as a low number would report
a broken detector as free-flowing traffic. Every aggregate here excludes it.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone


def _madrid_offset(naive: datetime) -> timezone:
    """
    UTC offset for Barcelona at a given local time.

    Used only when the IANA database is unavailable -- Windows ships no system
    tz data, so a fresh checkout without the `tzdata` package would otherwise
    raise ZoneInfoNotFoundError at import and take the whole feed module down
    with it. A missing optional dependency should not be able to do that.

    EU rule: summer time runs from the last Sunday in March to the last Sunday
    in October, UTC+2, and UTC+1 otherwise. The switch happens at 01:00 UTC;
    an hour either side of it this can be wrong, which shifts a freshness
    reading by one hour twice a year and is not worth more code than this.
    """
    def last_sunday(year: int, month: int) -> datetime:
        d = datetime(year + (month == 12), (month % 12) + 1, 1)
        d -= timedelta(days=1)
        return d - timedelta(days=(d.weekday() + 1) % 7)

    y = naive.year
    start = last_sunday(y, 3).replace(hour=2)    # 01:00 UTC = 02:00 local
    end = last_sunday(y, 10).replace(hour=3)     # 01:00 UTC = 03:00 local
    return timezone(timedelta(hours=2 if start <= naive < end else 1))


try:
    from zoneinfo import ZoneInfo

    BCN_TZ = ZoneInfo("Europe/Madrid")
except Exception:  # no IANA database on this machine
    BCN_TZ = None

# The live resource inside the `trams` dataset. Verified returning 532 rows
# stamped with the current time; see the module docstring for why none of the
# monthly CSVs in the same dataset can be used instead.
TRAMS_LIVE_URL = (
    "https://opendata-ajuntament.barcelona.cat/data/dataset/"
    "8319c2b1-4c21-4962-9acd-6db4c5ff1148/resource/"
    "2d456eb5-4ea6-4f68-9794-2f3f1a58a933/download"
)

# ASCII only: this string is rendered by the UI and echoed through JSON, and a
# stray em-dash came back through the API as mojibake.
ATTRIBUTION = "Open Data BCN / Ajuntament de Barcelona (CC BY 4.0)"

STATE_LABELS = {
    0: "no data",
    1: "very fluid",
    2: "fluid",
    3: "dense",
    4: "very dense",
    5: "congested",
    6: "blocked",
}

# At or above this the section counts as congested for the headline figure.
CONGESTED_AT = 4


def parse_trams(text: str) -> dict:
    """Parse the live TRAMS_TRAMS.dat body into a state summary."""
    sections: dict[int, dict] = {}
    newest: datetime | None = None
    malformed = 0

    for line in (text or "").splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split("#")
        if len(parts) < 4:
            malformed += 1
            continue
        try:
            sid = int(parts[0])
            naive = datetime.strptime(parts[1], "%Y%m%d%H%M%S")
            stamp = naive.replace(tzinfo=BCN_TZ or _madrid_offset(naive))
            actual = int(parts[2])
            forecast = int(parts[3])
        except (ValueError, TypeError):
            malformed += 1
            continue

        sections[sid] = {"actual": actual, "forecast": forecast,
                         "at": stamp.isoformat()}
        if newest is None or stamp > newest:
            newest = stamp

    counts = {v: 0 for v in STATE_LABELS}
    for s in sections.values():
        counts[s["actual"]] = counts.get(s["actual"], 0) + 1

    reporting = sum(n for v, n in counts.items() if v != 0)
    congested = sum(n for v, n in counts.items() if v >= CONGESTED_AT)

    age_s = None
    if newest is not None:
        age_s = (datetime.now(timezone.utc) - newest).total_seconds()

    return {
        "source": "opendata-bcn/trams",
        "attribution": ATTRIBUTION,
        "observed_at": newest.isoformat() if newest else None,
        "age_s": None if age_s is None else round(age_s, 1),
        "sections_total": len(sections),
        # Sections whose detector is reporting. The denominator for every
        # percentage below -- see the note on state 0 in the module docstring.
        "sections_reporting": reporting,
        "counts": {STATE_LABELS[v]: n for v, n in sorted(counts.items())},
        "congested": congested,
        "congested_pct": (round(100.0 * congested / reporting, 1)
                          if reporting else None),
        "malformed_rows": malformed,
        "sections": sections,
    }


def summary(parsed: dict) -> dict:
    """The small, display-safe part of the above, for the provenance panel."""
    return {k: v for k, v in parsed.items() if k != "sections"}
