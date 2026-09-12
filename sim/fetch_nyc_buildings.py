"""
Fetch real Manhattan building footprints from NYC Open Data.

REAL DATA. Every polygon and every height here is what New York City surveyed.

WHY NOT OVERPASS, LIKE BARCELONA
sim/fetch_buildings.py takes heights from OSM tags, falling back to
`building:levels` x 3.2 m and finally to a 15 m default described in its own
comments as "the Eixample's characteristic ~5 storeys". That fallback is
correct for Barcelona and badly wrong for Midtown, where an untagged building
is far more likely to be forty storeys than five. NYC publishes a measured roof
height for every building in the city, so there is no reason to guess here.

Dataset: Building Footprints, NYC Open Data resource 5zhs-2jue.
    https://data.cityofnewyork.us/City-Government/Building-Footprints/5zhs-2jue

TWO THINGS THIS FILE EXISTS TO GET RIGHT

1. HEIGHTS ARE IN FEET. The scene reads `h` as metres (see web/src/scene/
   buildings.js). Ingesting the raw column would stand Manhattan up 3.28x too
   tall, and it would look deliberate rather than broken -- a plausible-looking
   supertall skyline is exactly the kind of wrong that survives review.

2. THE SOURCE HAS CORRUPT ROWS. Some records carry the BIN in the height
   column, e.g. bin 2130353 with height_roof 2130353 -- a 649 km building. One
   of those inside the extract puts a spike through the camera and rescales the
   colour ramp so every real building goes black. They are dropped, loudly:
   a silent clamp would turn a data bug into a shrug.
"""

import json
import sys
import time
from pathlib import Path
from urllib.parse import quote

import requests

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "web" / "public" / "data" / "buildings_manhattan.geojson"
OUT.parent.mkdir(parents=True, exist_ok=True)

RESOURCE = "https://data.cityofnewyork.us/resource/5zhs-2jue"

# The Midtown Manhattan district, from web/public/districts.json. Matches the
# SUMO extract the recorded twins were run over, so the buildings line up with
# the traffic rather than covering some neighbouring rectangle.
#            south      west     north      east
BBOX = (40.743, -74.000, 40.768, -73.970)

FEET_TO_M = 0.3048

# Above this, the row is not a building. One World Trade is 1,776 ft to the tip
# of its spire and is the tallest thing in the city, so anything past 2,000 ft
# is a data error rather than an unusually ambitious tower.
MAX_PLAUSIBLE_FT = 2000.0

# Below this a "building" is a stoop, a parapet fragment, or a digitising
# artefact. Extruding those produces a carpet of 30 cm slabs that costs draw
# calls and shows nothing.
MIN_PLAUSIBLE_FT = 6.0

# Socrata caps a single page well below the number of buildings here.
PAGE = 5000


def fetch_page(bbox, offset, limit=PAGE):
    """One page of footprints as GeoJSON features."""
    s, w, n, e = bbox
    where = f"within_box(the_geom,{n},{w},{s},{e})"
    url = (
        f"{RESOURCE}.geojson"
        f"?$where={quote(where)}"
        f"&$select=the_geom,bin,height_roof,construction_year,feature_code"
        f"&$limit={limit}&$offset={offset}"
        # Without an explicit order Socrata does not guarantee a stable page
        # boundary, and paging an unordered result silently duplicates some
        # rows and drops others.
        f"&$order=bin"
    )
    r = requests.get(url, timeout=180,
                     headers={"User-Agent": "mainstreetai/1.0"})
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")
    return r.json().get("features", [])


def clean_height_m(props):
    """
    Roof height in METRES, or None if the row cannot be trusted.

    Returns None rather than a default. A building with no usable height is
    better left out than drawn at an invented one -- the Barcelona script has
    to guess because OSM often has nothing, but here a missing height means
    this particular record is broken, not that the data lacks the column.
    """
    raw = props.get("height_roof")
    if raw in (None, ""):
        return None
    try:
        ft = float(raw)
    except (TypeError, ValueError):
        return None

    # The observed corruption: the height column holding the BIN.
    if props.get("bin") and str(raw).split(".")[0] == str(props["bin"]).strip():
        return None

    if not (MIN_PLAUSIBLE_FT <= ft <= MAX_PLAUSIBLE_FT):
        return None
    return ft * FEET_TO_M


def round_geom(geom):
    """Six decimal places is ~11 cm. Past that is file size, not precision."""
    def ring(coords):
        return [[round(x, 6), round(y, 6)] for x, y in coords]

    t = geom.get("type")
    if t == "Polygon":
        return {"type": "Polygon", "coordinates": [ring(r) for r in geom["coordinates"]]}
    if t == "MultiPolygon":
        return {
            "type": "MultiPolygon",
            "coordinates": [[ring(r) for r in poly] for poly in geom["coordinates"]],
        }
    return None


def fetch(bbox=BBOX):
    s, w, n, e = bbox
    km_ns = (n - s) * 111.0
    km_ew = (e - w) * 84.5  # at 40.75 N
    print(f"[nyc] bbox S={s:.4f} W={w:.4f} N={n:.4f} E={e:.4f}"
          f"   ({km_ew:.1f} x {km_ns:.1f} km)")

    raw = []
    offset = 0
    t0 = time.time()
    while True:
        try:
            page = fetch_page(bbox, offset)
        except Exception as exc:
            # Partial data is worse than none: it would look like a city with
            # holes in it and give no clue why.
            sys.exit(f"[abort] page at offset {offset} failed: {exc}\n"
                     f"        {OUT.name} left untouched.")
        raw.extend(page)
        print(f"[nyc] +{len(page):,} (total {len(raw):,})")
        if len(page) < PAGE:
            break
        offset += PAGE

    print(f"[nyc] {len(raw):,} rows in {time.time() - t0:.1f}s")

    feats = []
    dropped_height = 0
    dropped_geom = 0
    corrupt = []

    for f in raw:
        props = f.get("properties") or {}
        geom = round_geom(f.get("geometry") or {})
        if geom is None:
            dropped_geom += 1
            continue

        h = clean_height_m(props)
        if h is None:
            dropped_height += 1
            if props.get("bin") and str(props.get("height_roof", "")).split(".")[0] \
                    == str(props["bin"]).strip():
                corrupt.append(props["bin"])
            continue

        feats.append({
            "type": "Feature",
            "geometry": geom,
            # `h` and `min_h` are the names web/src/scene/buildings.js reads.
            # min_h stays 0: NYC's ground_elevation is TERRAIN height above sea
            # level, not the building's base above the street. Feeding it in as
            # min_h would lift every building into the air by the elevation of
            # the ground it stands on.
            "properties": {"h": round(h, 1), "min_h": 0},
        })

    if not feats:
        raise SystemExit(
            f"[abort] no usable buildings for this bbox. {OUT.name} untouched."
        )

    tmp = OUT.with_suffix(".geojson.tmp")
    tmp.write_text(
        json.dumps({"type": "FeatureCollection", "features": feats},
                   separators=(",", ":")),
        encoding="utf-8",
    )
    tmp.replace(OUT)

    mb = OUT.stat().st_size / 1e6
    hs = sorted(p["properties"]["h"] for p in feats)
    print(f"\n[ok] {OUT.name}: {len(feats):,} buildings, {mb:.1f} MB")
    print(f"     heights: min {hs[0]:.0f} m, median {hs[len(hs) // 2]:.0f} m, "
          f"p99 {hs[int(len(hs) * 0.99)]:.0f} m, max {hs[-1]:.0f} m")
    print(f"     dropped: {dropped_height:,} unusable heights, "
          f"{dropped_geom:,} unusable geometry")
    if corrupt:
        print(f"     of those, {len(corrupt)} had the BIN in the height column: "
              f"{', '.join(corrupt[:5])}{' ...' if len(corrupt) > 5 else ''}")


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(
        description="Fetch NYC building footprints for the 3D Manhattan scene.")
    ap.add_argument("--bbox", type=str, default=None,
                    help="explicit bbox as S,W,N,E (default: the Midtown district)")
    args = ap.parse_args()

    box = BBOX
    if args.bbox:
        box = tuple(float(v) for v in args.bbox.split(","))
        if len(box) != 4:
            raise SystemExit("--bbox needs exactly four values: S,W,N,E")

    fetch(box)
