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
#            south      west     north      east
BBOX = (41.3805, 2.1470, 41.4045, 2.1840)

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

QUERY = f"""
[out:json][timeout:240];
way["building"]["building"!="roof"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
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


def fetch() -> None:
    last_err = None
    data = None
    for i, url in enumerate(ENDPOINTS, 1):
        print(f"[overpass] mirror {i}/{len(ENDPOINTS)}: {url}")
        print(f"[overpass] bbox S={BBOX[0]} W={BBOX[1]} N={BBOX[2]} E={BBOX[3]}")
        try:
            t0 = time.time()
            r = requests.post(url, data={"data": QUERY}, timeout=300,
                              headers={"User-Agent": "mainstreetai/1.0"})
            if r.status_code != 200:
                last_err = f"HTTP {r.status_code}"
                print(f"[overpass] {last_err} — next mirror")
                continue
            data = r.json()
            print(f"[overpass] OK {len(r.content) / 1e6:.1f} MB in {time.time() - t0:.1f}s")
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

    OUT.write_text(
        json.dumps({"type": "FeatureCollection", "features": feats},
                   separators=(",", ":")),
        encoding="utf-8",
    )

    mb = OUT.stat().st_size / 1e6
    heights = [f["properties"]["h"] for f in feats]
    print(f"\n[ok] {OUT.name}: {len(feats):,} buildings, {mb:.1f} MB")
    print(f"     height source: {by_source['height']:,} tagged in metres, "
          f"{by_source['levels']:,} from levels, {by_source['default']:,} defaulted")
    print(f"     heights: min {min(heights):.0f} m, median "
          f"{sorted(heights)[len(heights) // 2]:.0f} m, max {max(heights):.0f} m")
    print(f"     skipped: {skipped_open:,} unusable rings, {skipped_small:,} slivers")


if __name__ == "__main__":
    fetch()
