"""
The city registry: what the pipeline has already baked, and what it would take
to add another.

WHY THIS IS A REGISTRY AND NOT A "TYPE A CITY NAME" BOX
The plan asks for a selector that re-runs the pipeline for any city. The
pipeline is three stages and only one of them is fast:

    city2graph transit     seconds -- but needs a GTFS feed for that city,
                           and load_gtfs() takes a local path. There is no
                           feed discovery, so a human sources the zip.
    prettymaps basemap     25-60 minutes, Overpass-bound. Measured 26 min for
                           Barcelona's 67 km2 square.
    SUMO network + demand  minutes: fetch_osm -> netconvert -> randomTrips ->
                           duarouter, then the twin has to load a 30 MB network
                           before its first frame.

So a city that is already baked is instant, and a city that is not cannot be
made ready inside a page load. Pretending otherwise would mean a selector that
appears to work and then hangs for half an hour in front of an audience.

This registry is what the UI reads. A city is `ready` when every artefact it
needs is on disk; anything else is listed with exactly what is missing, so the
selector can offer it honestly rather than failing at click time.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
NET = ROOT / "sim" / "net"


@dataclass
class City:
    key: str
    label: str
    # Everything below is optional metadata for cities that are not built yet.
    place: str = ""
    gtfs_hint: str = ""
    notes: str = ""

    def artefacts(self) -> dict[str, Path]:
        """The files this city needs, by role."""
        suffix = "" if self.key == "barcelona" else f"_{self.key}"
        return {
            "basemap": DATA / f"basemap_{self.key}.png",
            "basemap_meta": DATA / f"basemap_{self.key}.json",
            "network": NET / f"barcelona{suffix}.net.xml",
            "signals": DATA / ("signal_approaches.geojson" if self.key == "barcelona"
                               else f"signal_approaches_{self.key}.geojson"),
            "transit": DATA / ("transit.geojson" if self.key == "barcelona"
                               else f"transit_{self.key}.geojson"),
        }

    def status(self) -> dict:
        arts = self.artefacts()
        present = {k: p.exists() for k, p in arts.items()}
        missing = [k for k, ok in present.items() if not ok]

        # A basemap with no transform sidecar is worse than no basemap: the
        # renderer would have an image it cannot place anything on.
        transform_ok = False
        if present.get("basemap_meta"):
            try:
                meta = json.loads(arts["basemap_meta"].read_text(encoding="utf-8"))
                transform_ok = bool(meta.get("lonlat_to_px"))
                if not transform_ok:
                    missing.append("basemap transform (run build_basemap --patch)")
            except Exception:
                missing.append("basemap sidecar unreadable")

        # Transit is genuinely optional: the simulation runs without real bus
        # routes, it just cannot claim them.
        blocking = [m for m in missing if not m.startswith("transit")]

        return {
            "key": self.key,
            "label": self.label,
            "ready": not blocking,
            "missing": missing,
            "has_transit": present.get("transit", False),
            "size_mb": round(
                sum(p.stat().st_size for p in arts.values() if p.exists()) / 1e6, 1),
            "notes": self.notes,
        }


# Barcelona is built. The others are declared so the selector can show what the
# pipeline would do, with the honest cost attached, rather than implying that
# typing a name is enough.
CITIES: list[City] = [
    City("barcelona", "Barcelona", place="Barcelona, Spain",
         gtfs_hint="TMB via Mobility Database mdb-2359",
         notes="Default. Fully built."),
    City("lisbon", "Lisbon", place="Lisboa, Portugal",
         gtfs_hint="Carris / CP — needs sourcing",
         notes="Not built. ~26 min basemap bake plus a SUMO network build."),
    City("valencia", "Valencia", place="Valencia, Spain",
         gtfs_hint="EMT Valencia — needs sourcing",
         notes="Not built. ~26 min basemap bake plus a SUMO network build."),
]

BY_KEY = {c.key: c for c in CITIES}


def registry() -> dict:
    cities = [c.status() for c in CITIES]
    return {
        "cities": cities,
        "default": "barcelona",
        "ready": [c["key"] for c in cities if c["ready"]],
        "build_cost": {
            "basemap_minutes": "25-60, Overpass-bound",
            "network_minutes": "several, plus a 30 MB load per twin",
            "transit": "needs a GTFS zip; load_gtfs takes a local path and "
                       "city2graph has no feed discovery",
        },
    }


if __name__ == "__main__":
    r = registry()
    print(f"{'city':<12}{'ready':>7}{'transit':>9}{'size':>9}   missing")
    print("-" * 70)
    for c in r["cities"]:
        print(f"{c['label']:<12}{'yes' if c['ready'] else 'no':>7}"
              f"{'yes' if c['has_transit'] else 'no':>9}"
              f"{c['size_mb']:>8.1f}M   "
              + (", ".join(c["missing"])[:38] if c["missing"] else "-"))
