"""
Fetch REAL published City of Barcelona datasets to overlay on the simulation.

Source: Open Data BCN (opendata-ajuntament.barcelona.cat), the Ajuntament's
official CKAN portal. These are genuine municipal datasets, not modelled:

  carril-bici                  The city's bicycle lane network (GeoJSON)
  informacio-estacions-bicing  Bicing docking stations (JSON)

Both go on the map labelled as real, which matters: the pitch argues for
mode-shift toward cycling, and it is much stronger when the cycling
infrastructure shown is Barcelona's actual built network rather than something
we drew.

Bicing's endpoint is rate-limited and sometimes requires a portal token; if it
refuses, we skip it and say so rather than substituting invented stations.
"""

import json
import os
import sys
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "web" / "public" / "data"
OUT.mkdir(parents=True, exist_ok=True)

# Our simulation extract; anything outside it is dropped so the overlay lines up.
BBOX = (2.1053, 41.3593, 2.2188, 41.4248)  # west, south, east, north

BIKE_URL = ("https://opendata-ajuntament.barcelona.cat/data/dataset/"
            "e3497ea4-0bae-4093-94a7-119df50a8a74/resource/"
            "4608cf0c-2f11-4a25-891f-c5afc3af82c5/download")
BICING_URL = ("https://opendata-ajuntament.barcelona.cat/data/dataset/"
              "bd2462df-6e1e-4e37-8205-a4b8e7313b84/resource/"
              "f60e9291-5aaa-417d-9b91-612a9de800aa/download")

UA = {"User-Agent": "bcn-traffic-ai-hackathon/1.0"}


def in_bbox(lon: float, lat: float) -> bool:
    return BBOX[0] <= lon <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]


def clip_line(coords: list) -> list | None:
    """Keep a line only if part of it falls inside our extract."""
    if not coords or not isinstance(coords[0], (list, tuple)):
        return None
    if any(in_bbox(c[0], c[1]) for c in coords if len(c) >= 2):
        return [[round(c[0], 6), round(c[1], 6)] for c in coords if len(c) >= 2]
    return None


def fetch_bike_lanes() -> int:
    print("[open data bcn] bicycle lane network ...")
    r = requests.get(BIKE_URL, timeout=120, headers=UA)
    r.raise_for_status()
    gj = r.json()

    feats = []
    for f in gj.get("features", []):
        geom = f.get("geometry") or {}
        gtype = geom.get("type")
        props = f.get("properties", {}) or {}
        name = (props.get("NOM_CARRER") or props.get("nom_carrer")
                or props.get("TOOLTIP") or props.get("name") or "")

        lines = []
        if gtype == "LineString":
            c = clip_line(geom.get("coordinates", []))
            if c:
                lines.append(c)
        elif gtype == "MultiLineString":
            for part in geom.get("coordinates", []):
                c = clip_line(part)
                if c:
                    lines.append(c)

        for c in lines:
            feats.append({
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": c},
                "properties": {"name": str(name)[:60]},
            })

    out = OUT / "bike_lanes.geojson"
    out.write_text(json.dumps({"type": "FeatureCollection", "features": feats},
                              separators=(",", ":")), encoding="utf-8")
    km = 0.0
    for f in feats:
        cs = f["geometry"]["coordinates"]
        for a, b in zip(cs, cs[1:]):
            dx = (b[0] - a[0]) * 83_000     # metres per degree lon at 41.4 N
            dy = (b[1] - a[1]) * 111_320
            km += (dx * dx + dy * dy) ** 0.5 / 1000
    print(f"  -> {out.name}: {len(feats):,} segments, ~{km:,.0f} km inside the extract")
    return len(feats)


def fetch_bicing() -> int:
    """
    Bicing sits behind a free Open Data BCN portal token (the download URL 302s
    to /tokens without one). Set BCN_OPENDATA_TOKEN to enable it:

        $env:BCN_OPENDATA_TOKEN = "<your token>"   # PowerShell
        export BCN_OPENDATA_TOKEN=<your token>     # bash

    Without a token we skip the layer entirely rather than inventing docks.
    """
    print("[open data bcn] Bicing stations ...")
    token = os.environ.get("BCN_OPENDATA_TOKEN", "").strip()
    headers = dict(UA)
    if token:
        headers["Authorization"] = token
    else:
        print("  .. no BCN_OPENDATA_TOKEN set; this dataset requires one.")

    try:
        r = requests.get(BICING_URL, timeout=90, headers=headers,
                         allow_redirects=False)
        if r.status_code in (301, 302, 303, 307, 308):
            raise RuntimeError("portal redirected to its token page "
                               "(dataset needs BCN_OPENDATA_TOKEN)")
        r.raise_for_status()
        payload = r.json()
    except Exception as exc:
        print(f"  !! unavailable ({type(exc).__name__}: {exc})")
        print("     Skipping. The map simply will not show Bicing docks; we do")
        print("     not substitute invented station locations.")
        return 0

    # GBFS-style: {"data": {"stations": [...]}}
    stations = (payload.get("data") or {}).get("stations") or payload.get("stations") or []
    feats = []
    for s in stations:
        lon, lat = s.get("lon"), s.get("lat")
        if lon is None or lat is None or not in_bbox(lon, lat):
            continue
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {
                "name": (s.get("name") or "")[:60],
                "capacity": s.get("capacity") or 0,
            },
        })

    out = OUT / "bicing.geojson"
    out.write_text(json.dumps({"type": "FeatureCollection", "features": feats},
                              separators=(",", ":")), encoding="utf-8")
    print(f"  -> {out.name}: {len(feats):,} stations inside the extract")
    return len(feats)


if __name__ == "__main__":
    n_bike = 0
    try:
        n_bike = fetch_bike_lanes()
    except Exception as exc:
        print(f"  !! bike lanes failed: {type(exc).__name__}: {exc}", file=sys.stderr)
    n_dock = fetch_bicing()
    print(f"\n[ok] real Open Data BCN layers: {n_bike:,} bike-lane segments, "
          f"{n_dock:,} Bicing stations")
