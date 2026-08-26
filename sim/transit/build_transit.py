"""
Real public-transport geometry for the simulated extent, via city2graph.

WHY THIS EXISTS
---------------
Until now the project had no real transit lines. The README said so plainly:
"TMB does not publish an open GTFS feed on the municipal portal, so bus routes
are not real line geometries." That is true of the municipal portal, but TMB
publishes GTFS through its own developer API, updated weekly -- it was a
registration gap, not an availability gap. A key-free mirror on the Mobility
Database makes it usable without an account at all.

That matters more here than it would in most projects, because the whole
transit-priority argument rests on buses. Serving them on real routes rather
than on whatever links happened to permit buses is the difference between
"buses go faster" and "route V15 goes faster".

WHAT city2graph IS AND IS NOT USED FOR
--------------------------------------
It is used for the transit layer only. It has no OpenStreetMap street fetcher:
its data functions are load_overture_data / process_overture_segments /
get_boundaries, and its graph builders consume GeoDataFrames you already have.
Streets therefore keep coming from OSM via netconvert, which produces the lane
counts, turn restrictions and signal programs a microsimulation needs and which
neither Overture segments nor a morphological graph carry.

OUTPUT
------
web/public/data/transit.geojson -- routes (LineString, from shapes.txt) and
stops (Point), clipped to the simulation extent, tagged by mode.

    python sim/transit/build_transit.py
    python sim/transit/build_transit.py --gtfs path/to/other_city.zip
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import zipfile
from collections import defaultdict
from pathlib import Path

from shapely.geometry import LineString, box, mapping

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
DEFAULT_GTFS = HERE / "cache" / "tmb_gtfs.zip"
OUT = ROOT / "web" / "public" / "data" / "transit.geojson"

# GTFS route_type -> the vehicle kinds this project already speaks.
ROUTE_TYPE = {
    "0": "tram", "1": "metro", "2": "rail", "3": "bus",
    "4": "ferry", "5": "cable", "6": "gondola", "7": "funicular",
}

# Modes worth drawing on a street map. Metro is underground and rail is mostly
# out of the extract, but both are kept and tagged so the renderer can decide;
# dropping them here would be a decision made in the wrong place.
SURFACE_MODES = {"bus", "tram", "funicular"}


def read_csv(z: zipfile.ZipFile, name: str) -> list[dict]:
    if name not in z.namelist():
        return []
    with z.open(name) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, "utf-8-sig")))


def sim_extent() -> tuple[float, float, float, float]:
    """
    The simulation's own footprint, taken from the signal lamps rather than
    meta.json. meta.json records the bbox the network was REQUESTED with;
    the lamps are where the network actually ended up, and clipping transit to
    a slightly wrong rectangle would quietly drop real routes at the edges.
    """
    sig = json.loads((ROOT / "web" / "public" / "data" /
                      "signal_approaches.geojson").read_text(encoding="utf-8"))
    lons = [f["geometry"]["coordinates"][0] for f in sig["features"]]
    lats = [f["geometry"]["coordinates"][1] for f in sig["features"]]
    return min(lons), min(lats), max(lons), max(lats)


def build(gtfs_path: Path) -> dict:
    z = zipfile.ZipFile(gtfs_path)
    W, S, E, N = sim_extent()

    routes = {r["route_id"]: r for r in read_csv(z, "routes.txt")}
    trips = read_csv(z, "trips.txt")
    stops = {s["stop_id"]: s for s in read_csv(z, "stops.txt")}

    # shape_id -> ordered points. This is the payload that makes the layer
    # worth having: the real path a vehicle takes, not a straight line between
    # stops.
    shape_pts: dict[str, list] = defaultdict(list)
    for row in read_csv(z, "shapes.txt"):
        try:
            shape_pts[row["shape_id"]].append((
                int(row["shape_pt_sequence"]),
                float(row["shape_pt_lon"]),
                float(row["shape_pt_lat"]),
            ))
        except (ValueError, KeyError):
            continue

    # One representative shape per route: the longest, which is normally the
    # full-length variant rather than a short-working or depot run.
    route_shape: dict[str, str] = {}
    for t in trips:
        rid, sid = t.get("route_id"), t.get("shape_id")
        if not rid or not sid or sid not in shape_pts:
            continue
        best = route_shape.get(rid)
        if best is None or len(shape_pts[sid]) > len(shape_pts[best]):
            route_shape[rid] = sid

    # CLIP, do not merely filter.
    #
    # TMB's feed is metropolitan and the simulation is a 8.0 x 6.4 km extract,
    # so most routes run well past its edge. Keeping any route that merely
    # TOUCHES the box keeps it whole, trailing kilometres of geometry over
    # streets the simulation has never heard of. Measured on the first
    # attempt: median distance from a bus vertex to the nearest mapped road
    # was a healthy 17 m, but p90 was 2,347 m -- and 2.3 km from any arterial
    # is not a missing-residential-street tail, it is track that should never
    # have been in the file.
    #
    # A clipped route can leave the box and come back, so the result is a
    # MultiLineString rather than a LineString. Keeping it as one feature
    # preserves route identity; splitting into fragments would make "route
    # V15" several unrelated lines on the map.
    clip_box = box(W, S, E, N)

    features = []
    kept_by_mode: defaultdict[str, int] = defaultdict(int)
    dropped_no_shape = 0
    dropped_outside = 0

    for rid, sid in route_shape.items():
        meta = routes.get(rid, {})
        mode = ROUTE_TYPE.get(meta.get("route_type", ""), "other")
        pts = sorted(shape_pts[sid])
        if len(pts) < 2:
            continue

        line = LineString([(lon, lat) for _, lon, lat in pts])
        piece = line.intersection(clip_box)
        if piece.is_empty:
            dropped_outside += 1
            continue

        geom = mapping(piece)
        if geom["type"] == "LineString":
            geom["coordinates"] = [[round(x, 6), round(y, 6)]
                                   for x, y in geom["coordinates"]]
        elif geom["type"] == "MultiLineString":
            geom["coordinates"] = [[[round(x, 6), round(y, 6)] for x, y in part]
                                   for part in geom["coordinates"]]
        else:
            # A tangent touch yields a Point/GeometryCollection: no usable run
            # inside the box.
            dropped_outside += 1
            continue

        features.append({
            "type": "Feature",
            "geometry": geom,
            "properties": {
                "kind": "route",
                "mode": mode,
                "surface": mode in SURFACE_MODES,
                "route_id": rid,
                "short_name": meta.get("route_short_name", ""),
                "long_name": meta.get("route_long_name", ""),
                "colour": ("#" + meta["route_color"]) if meta.get("route_color") else None,
                "clipped": geom["type"] == "MultiLineString",
                "inside_km": round(piece.length * 84.9, 2),
            },
        })
        kept_by_mode[mode] += 1

    for rid in routes:
        if rid not in route_shape:
            dropped_no_shape += 1

    stops_kept = 0
    for s in stops.values():
        try:
            lon, lat = float(s["stop_lon"]), float(s["stop_lat"])
        except (ValueError, KeyError):
            continue
        if not (W <= lon <= E and S <= lat <= N):
            continue
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {"kind": "stop", "stop_id": s["stop_id"],
                           "name": s.get("stop_name", "")},
        })
        stops_kept += 1

    return {
        "type": "FeatureCollection",
        "features": features,
        "properties": {
            "source": "TMB GTFS via Mobility Database (mdb-2359)",
            "attribution": "Transports Metropolitans de Barcelona",
            "extent": [W, S, E, N],
            "routes_kept": dict(kept_by_mode),
            "stops_kept": stops_kept,
            "routes_without_shape": dropped_no_shape,
            "routes_outside_extent": dropped_outside,
        },
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--gtfs", type=Path, default=DEFAULT_GTFS)
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    if not args.gtfs.exists():
        raise SystemExit(f"[abort] GTFS not found: {args.gtfs}")

    fc = build(args.gtfs)
    p = fc["properties"]
    if not fc["features"]:
        raise SystemExit("[abort] no transit features inside the simulation "
                         "extent -- wrong city's feed, or a bbox mismatch. "
                         f"{args.out.name} left untouched.")

    tmp = args.out.with_suffix(".geojson.tmp")
    tmp.write_text(json.dumps(fc, separators=(",", ":")), encoding="utf-8")
    tmp.replace(args.out)

    total_routes = sum(p["routes_kept"].values())
    print(f"[ok] {args.out.name}: {total_routes} routes, {p['stops_kept']} stops "
          f"({args.out.stat().st_size / 1e6:.1f} MB)")
    print(f"     extent  lon {p['extent'][0]:.4f}..{p['extent'][2]:.4f}  "
          f"lat {p['extent'][1]:.4f}..{p['extent'][3]:.4f}")
    for mode, n in sorted(p["routes_kept"].items(), key=lambda kv: -kv[1]):
        print(f"     {mode:<10} {n:>4} routes"
              + ("" if mode in SURFACE_MODES else "   (not surface running)"))
    if p["routes_without_shape"]:
        print(f"     {p['routes_without_shape']} route(s) carried no shape and "
              f"were skipped -- they would have been straight lines.")


if __name__ == "__main__":
    main()
