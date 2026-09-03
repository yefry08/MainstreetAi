"""
Export the SUMO network to GeoJSON for the web map.

Everything written here is derived from the real OSM/SUMO network:
geometry, street names, lane counts and signal positions. No invented features.

Outputs (into web/public/data/):
  roads.geojson    -- arterial + distributor edges, used for the live congestion
                      overlay. Residential streets are left to the basemap; we
                      still simulate them, we just don't re-draw 11k polylines.
  signals.geojson  -- one point per SUMO traffic-light system, with the incoming
                      edges it controls (used by the click-to-inspect panel).
  meta.json        -- bbox, centre, counts, corridor edge ids.
"""

import json
from collections import defaultdict
from pathlib import Path

import sumolib

HERE = Path(__file__).resolve().parent
import argparse as _argparse

_ap = _argparse.ArgumentParser()
_ap.add_argument("--district", default="barcelona")
DISTRICT = _ap.parse_known_args()[0].district

# Barcelona keeps the bare filenames the 3D scene and the live server have
# always fetched; every other district gets a "_<district>" suffix.
_sfx = "" if DISTRICT == "barcelona" else f"_{DISTRICT}"
NET = HERE / "net" / f"{DISTRICT}.net.xml"
OUT = HERE.parent / "web" / "public" / "data"

# Which OSM classes we re-draw ourselves, and how thick they read on the map.
TIERS = {
    "highway.motorway": ("arterial", 5),
    "highway.motorway_link": ("arterial", 3),
    "highway.trunk": ("arterial", 5),
    "highway.trunk_link": ("arterial", 3),
    "highway.primary": ("arterial", 4),
    "highway.primary_link": ("arterial", 3),
    "highway.secondary": ("distributor", 3),
    "highway.secondary_link": ("distributor", 2),
    "highway.tertiary": ("local", 2),
    "highway.tertiary_link": ("local", 2),
}

# The three corridors the pitch calls out by name.
CORRIDORS = {
    "gran_via": ("gran via de les corts", "gran vía"),
    "diagonal": ("diagonal",),
    "meridiana": ("meridiana",),
}


def classify_corridor(name: str) -> str | None:
    low = (name or "").lower()
    for key, needles in CORRIDORS.items():
        if any(n in low for n in needles):
            return key
    return None


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"loading {NET.name} ...")
    net = sumolib.net.readNet(str(NET), withPrograms=True, withConnections=True)

    # ---------------- roads ----------------
    features = []
    corridor_edges: dict[str, list[str]] = defaultdict(list)

    for edge in net.getEdges():
        etype = edge.getType() or ""
        if etype not in TIERS:
            continue
        tier, weight = TIERS[etype]

        coords = []
        for x, y in edge.getShape():
            lon, lat = net.convertXY2LonLat(x, y)
            coords.append([round(lon, 6), round(lat, 6)])
        if len(coords) < 2:
            continue

        name = edge.getName() or ""
        corridor = classify_corridor(name)
        eid = edge.getID()
        if corridor:
            corridor_edges[corridor].append(eid)

        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {
                "id": eid,
                "name": name,
                "tier": tier,
                "w": weight,
                "lanes": edge.getLaneNumber(),
                "vmax": round(edge.getSpeed(), 1),
                "len": round(edge.getLength(), 1),
                **({"corridor": corridor} if corridor else {}),
            },
        })

    (OUT / f"roads{_sfx}.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"  roads{_sfx}.geojson   {len(features):,} edges  "
          f"({(OUT / f'roads{_sfx}.geojson').stat().st_size / 1e6:.1f} MB)")

    # ---------------- traffic lights ----------------
    sig_features = []
    for tls in net.getTrafficLights():
        conns = tls.getConnections()          # (inLane, outLane, linkIndex)
        if not conns:
            continue

        # Junction centre = mean of the stop-line ends of every incoming lane.
        xs, ys, in_edges, names = [], [], set(), set()
        for in_lane, _out_lane, _idx in conns:
            shape = in_lane.getShape()
            xs.append(shape[-1][0])
            ys.append(shape[-1][1])
            e = in_lane.getEdge()
            in_edges.add(e.getID())
            if e.getName():
                names.add(e.getName())
        if not xs:
            continue

        lon, lat = net.convertXY2LonLat(sum(xs) / len(xs), sum(ys) / len(ys))
        progs = tls.getPrograms()
        nphases = len(next(iter(progs.values())).getPhases()) if progs else 0

        label = " / ".join(sorted(names)[:2]) or tls.getID()
        sig_features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {
                "id": tls.getID(),
                "label": label,
                "links": len(conns),
                "phases": nphases,
                "in_edges": sorted(in_edges),
                "corridor": classify_corridor(" ".join(names)),
            },
        })

    (OUT / f"signals{_sfx}.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": sig_features}, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"  signals.geojson {len(sig_features):,} traffic lights")

    # ---------------- meta ----------------
    (xmin, ymin), (xmax, ymax) = net.getBBoxXY()
    lon0, lat0 = net.convertXY2LonLat(xmin, ymin)
    lon1, lat1 = net.convertXY2LonLat(xmax, ymax)

    meta = {
        "bbox": [round(lon0, 6), round(lat0, 6), round(lon1, 6), round(lat1, 6)],
        "center": [round((lon0 + lon1) / 2, 6), round((lat0 + lat1) / 2, 6)],
        "counts": {
            "edges_total": len(net.getEdges()),
            "edges_drawn": len(features),
            "junctions": len(net.getNodes()),
            "traffic_lights": len(sig_features),
            "lane_km": round(sum(e.getLength() * e.getLaneNumber() for e in net.getEdges()) / 1000, 1),
        },
        "corridors": {k: v for k, v in corridor_edges.items()},
        "source": {
            "network": "OpenStreetMap via Overpass API (real)",
            "demand": "randomTrips.py statistical demand (synthetic)",
            "emissions": "SUMO HBEFA3 model (real model, synthetic traffic)",
        },
    }
    (OUT / f"meta{_sfx}.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"  meta.json       corridors: " +
          ", ".join(f"{k}={len(v)}" for k, v in corridor_edges.items()))
    print(f"\n[ok] wrote to {OUT}")


if __name__ == "__main__":
    main()
