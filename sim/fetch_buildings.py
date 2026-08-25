"""
Fetch real Barcelona building footprints from OpenStreetMap.

REAL DATA. Every polygon and every height here is what OSM holds for Barcelona.

Why fetch these ourselves rather than lean on the basemap's building layer:

  * Only the OpenMapTiles schema carries per-building height, and the one free
    key-less host serving it is a single point of failure. On a conference wifi
    (or, as it happens, from this build sandbox) that host is exactly what
    stops resolving, and the 3D city silently flattens to nothing.
  * Owning the geometry means we can render it ourselves — real lighting, real
    materials — instead of being limited to what a basemap paint property will
    do.
  * It makes the whole demo work offline.

Heights come from `height` where tagged, else `building:levels` x 3.2 m, else a
class default. Barcelona's Eixample is overwhelmingly tagged by levels rather
than metres, so the levels path carries most of the city.
"""

import json
import math
import sys
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "web" / "public" / "data" / "buildings.geojson"
OUT.parent.mkdir(parents=True, exist_ok=True)

# Focused on the Eixample core, where the demo actually happens. The full
# simulation extract would be ~10x this and far too heavy to hand a browser as
# one GeoJSON file.
#
# THIS IS SMALLER THAN THE SIMULATION. Signals and traffic span roughly
# 8.0 x 6.4 km; these buildings cover 2.7 x 3.1 km, about 17% of that footprint
# by area. Pull the camera back far enough and the 3D city visibly stops while
# traffic carries on over flat basemap. That is the price of the decision
# above, and it is a real one -- so `--expand` exists to revisit it with
# measurements rather than by rewriting this line.
#
#   python sim/fetch_buildings.py --expand 2      # 2x linear, 4x area
#   python sim/fetch_buildings.py --bbox S,W,N,E  # explicit
#
# MEASURED, so the trade is a decision rather than a guess:
#
#   default      2.7 x 3.1 km    10,425 buildings     3.8 MB    17% coverage
#   --expand 2   6.1 x 5.3 km    29,991 buildings    11.1 MB    63% coverage
#
# Weigh it against the target hardware, not the download: the file is served
# from localhost in demo mode, so its size costs nothing on the wire. What it
# costs is browser parse time and GPU load for ~30k extruded polygons, and the
# stated target is an Intel N100 with integrated graphics. The default is kept
# because that cost has NOT been measured on the target machine -- try
# --expand 2 there, watch the frame rate, and keep it if it holds.
#            south      west     north      east
BBOX = (41.3805, 2.1470, 41.4045, 2.1840)


def expand_bbox(bbox, factor):
    """Grow a bbox about its centre by `factor` in each linear dimension."""
    s, w, n, e = bbox
    clat, clon = (s + n) / 2.0, (w + e) / 2.0
    dlat, dlon = (n - s) / 2.0 * factor, (e - w) / 2.0 * factor
    return (clat - dlat, clon - dlon, clat + dlat, clon + dlon)

STOREY_M = 3.2  # a Barcelona residential floor, roughly

# Fallbacks when a building carries neither height nor levels.
DEFAULT_HEIGHT = {
    "church": 22.0, "cathedral": 34.0, "hotel": 24.0, "office": 22.0,
    "commercial": 14.0, "retail": 10.0, "industrial": 9.0, "warehouse": 9.0,
    "school": 12.0, "university": 18.0, "hospital": 20.0, "garage": 4.0,
    "garages": 4.0, "roof": 4.0, "shed": 3.0, "hut": 3.0, "kiosk": 3.0,
    "apartments": 19.0, "residential": 16.0, "house": 8.0, "terrace": 11.0,
}
FALLBACK_HEIGHT = 15.0  # the Eixample's characteristic ~5 storeys

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
]

def build_query(bbox) -> str:
    return f"""
[out:json][timeout:240];
way["building"]["building"!="roof"]({bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]});
out geom;
"""


def parse_height(tags: dict) -> float:
    """Metres. Prefers explicit height, then levels, then a class default."""
    raw = tags.get("height") or tags.get("building:height")
    if raw:
        try:
            # Values arrive as "18", "18 m", "18.5m"
            return max(2.0, float(str(raw).lower().replace("m", "").strip()))
        except ValueError:
            pass

    levels = tags.get("building:levels")
    if levels:
        try:
            n = float(str(levels).split(";")[0].strip())
            if n > 0:
                # +1 m for the ground floor being taller and for roof furniture
                return max(3.0, n * STOREY_M + 1.0)

        except ValueError:
            pass

    return DEFAULT_HEIGHT.get(tags.get("building", ""), FALLBACK_HEIGHT)


def parse_min_height(tags: dict) -> float:
    raw = tags.get("min_height")
    if raw:
        try:
            return max(0.0, float(str(raw).lower().replace("m", "").strip()))
        except ValueError:
            pass
    lv = tags.get("building:min_level")
    if lv:
        try:
            return max(0.0, float(lv) * STOREY_M)
        except ValueError:
            pass
    return 0.0


def ring_area_m2(coords) -> float:
    """Rough planar area, only used to discard slivers."""
    if len(coords) < 4:
        return 0.0
    lat0 = coords[0][1]
    mlon = 111320.0 * math.cos(math.radians(lat0))
    mlat = 111320.0
    a = 0.0
    for (x1, y1), (x2, y2) in zip(coords, coords[1:]):
        a += (x1 * mlon) * (y2 * mlat) - (x2 * mlon) * (y1 * mlat)
    return abs(a) / 2.0


def fetch(bbox=BBOX) -> None:
    query = build_query(bbox)
    km_ns = (bbox[2] - bbox[0]) * 111.0
    km_ew = (bbox[3] - bbox[1]) * 82.5
    last_err = None
    data = None
    for i, url in enumerate(ENDPOINTS, 1):
        print(f"[overpass] mirror {i}/{len(ENDPOINTS)}: {url}")
        print(f"[overpass] bbox S={bbox[0]:.4f} W={bbox[1]:.4f} "
              f"N={bbox[2]:.4f} E={bbox[3]:.4f}"
              f"   ({km_ew:.1f} x {km_ns:.1f} km)")
        try:
            t0 = time.time()
            r = requests.post(url, data={"data": query}, timeout=300,
                              headers={"User-Agent": "mainstreetai/1.0"})
            if r.status_code != 200:
                last_err = f"HTTP {r.status_code}"
                print(f"[overpass] {last_err} — next mirror")
                continue
            data = r.json()
            # A 200 is not the same as an answer. A loaded or rate-limited
            # mirror will happily return an empty element list with a cheerful
            # status code, and taking that as success means the next mirror --
            # which would have answered properly -- is never tried, and the
            # empty result goes on to overwrite good data. Observed: one
            # mirror returned 0 elements in 1.8s while another returned 30,290
            # for the identical query.
            n = len(data.get("elements", []))
            if n == 0:
                last_err = "200 but zero elements (mirror busy or rate limited)"
                remark = str(data.get("remark") or "").strip()
                if remark:
                    last_err += f": {remark[:120]}"
                print(f"[overpass] {last_err} — next mirror")
                data = None
                continue
            print(f"[overpass] OK {n:,} elements, "
                  f"{len(r.content) / 1e6:.1f} MB in {time.time() - t0:.1f}s")
            break
        except Exception as exc:
            last_err = f"{type(exc).__name__}: {exc}"
            print(f"[overpass] {last_err} — next mirror")

    if data is None:
        sys.exit(f"every Overpass mirror failed. last error: {last_err}")

    feats = []
    skipped_open = 0
    skipped_small = 0
    by_source = {"height": 0, "levels": 0, "default": 0}

    for el in data.get("elements", []):
        geom = el.get("geometry")
        if not geom or len(geom) < 4:
            skipped_open += 1
            continue
        tags = el.get("tags", {}) or {}

        ring = [[round(p["lon"], 6), round(p["lat"], 6)] for p in geom]
        # Close the ring if OSM left it open.
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        if len(ring) < 4:
            skipped_open += 1
            continue

        if ring_area_m2(ring) < 12.0:
            skipped_small += 1
            continue

        if tags.get("height") or tags.get("building:height"):
            by_source["height"] += 1
        elif tags.get("building:levels"):
            by_source["levels"] += 1
        else:
            by_source["default"] += 1

        h = parse_height(tags)
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [ring]},
            "properties": {
                "h": round(h, 1),
                "min_h": round(parse_min_height(tags), 1),
            },
        })

    # Refuse to publish an empty result over a good one.
    #
    # An Overpass mirror can answer 200 with an empty element list -- rate
    # limited, or a query it decided not to run -- and the old code wrote that
    # straight over buildings.geojson. The city then vanishes from the map with
    # no error anywhere, and the only way back is to re-fetch and hope the
    # mirror cooperates. Losing good data to a successful-looking HTTP response
    # is the worst possible trade.
    if not feats:
        raise SystemExit(
            f"[abort] Overpass returned no buildings for this bbox. "
            f"{OUT.name} left untouched.\n"
            f"        Usually a rate-limited or unhappy mirror -- wait a "
            f"minute and retry, or try a smaller --expand."
        )

    # Write beside the target and swap, so an interruption mid-write cannot
    # leave a truncated file that parses as far as the browser gets.
    tmp = OUT.with_suffix(".geojson.tmp")
    tmp.write_text(
        json.dumps({"type": "FeatureCollection", "features": feats},
                   separators=(",", ":")),
        encoding="utf-8",
    )
    tmp.replace(OUT)

    mb = OUT.stat().st_size / 1e6
    heights = [f["properties"]["h"] for f in feats]
    print(f"\n[ok] {OUT.name}: {len(feats):,} buildings, {mb:.1f} MB")
    print(f"     height source: {by_source['height']:,} tagged in metres, "
          f"{by_source['levels']:,} from levels, {by_source['default']:,} defaulted")
    print(f"     heights: min {min(heights):.0f} m, median "
          f"{sorted(heights)[len(heights) // 2]:.0f} m, max {max(heights):.0f} m")
    print(f"     skipped: {skipped_open:,} unusable rings, {skipped_small:,} slivers")


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(
        description="Fetch OSM building footprints for the 3D city.")
    ap.add_argument("--expand", type=float, default=1.0,
                    help="grow the default bbox about its centre by this "
                         "factor in each dimension (2 = 4x the area)")
    ap.add_argument("--bbox", type=str, default=None,
                    help="explicit bbox as S,W,N,E")
    args = ap.parse_args()

    if args.bbox:
        box = tuple(float(v) for v in args.bbox.split(","))
        if len(box) != 4:
            raise SystemExit("--bbox needs exactly four values: S,W,N,E")
    else:
        box = expand_bbox(BBOX, args.expand) if args.expand != 1.0 else BBOX

    fetch(box)
