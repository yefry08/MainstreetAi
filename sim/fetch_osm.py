"""
Fetch the Barcelona street network from OpenStreetMap via the Overpass API.

REAL DATA: street geometry, road classification, traffic-signal node positions,
oneway/lane tags and bus/bicycle access tags all come straight from OSM.
Nothing in this file is synthetic.

Bounding box covers central Barcelona: the full Eixample grid plus the three
corridors that matter for the demo -- Gran Via de les Corts Catalanes,
Avinguda Diagonal and Avinguda Meridiana -- extending west far enough to
include Camp Nou (used by the concert event scenario) and east to Glories.
"""

import argparse
import sys
import time
from pathlib import Path

import requests

from districts import DISTRICTS

HERE = Path(__file__).resolve().parent
NET_DIR = HERE / "net"
NET_DIR.mkdir(parents=True, exist_ok=True)

# Barcelona's box predates the district registry and is kept verbatim: it is
# the extract the network was validated against, and nudging it by a few metres
# would silently invalidate every number the demo quotes.
BARCELONA_BBOX = (41.3650, 2.1150, 41.4200, 2.2100)

# Road tiers we import. Keeping residential in gives us the authentic Eixample
# chamfered-block grid; without it Barcelona stops looking like Barcelona.
HIGHWAY_RE = (
    r"^(motorway|trunk|primary|secondary|tertiary|"
    r"unclassified|residential|living_street)(_link)?$"
)

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    # Not overpass.osm.ch: it holds Switzerland only, so any other district
    # comes back as a valid, nearly empty extract (see web/src/city/osm.js).
]

def build_query(bbox) -> str:
    s, w, n, e = bbox
    return f"""
[out:xml][timeout:300];
(
  way["highway"~"{HIGHWAY_RE}"]["area"!~"yes"]({s},{w},{n},{e});
  node["highway"="traffic_signals"]({s},{w},{n},{e});
);
(._;>;);
out body;
"""


def bbox_for(district: str):
    if district == "barcelona":
        return BARCELONA_BBOX
    for d in DISTRICTS:
        if d.key == district:
            return tuple(d.bbox)
    sys.exit(f"unknown district: {district} "
             f"(have: {', '.join(x.key for x in DISTRICTS)})")


def _post(query: str, floor: int) -> bytes | None:
    """One query, every mirror, a few rounds of patience. None if all fail."""
    for rnd, pause in enumerate((0, 30, 90, 180)):
        if pause:
            print(f"[overpass] round {rnd + 1}: waiting {pause}s")
            time.sleep(pause)
        for url in ENDPOINTS:
            try:
                resp = requests.post(url, data={"data": query}, timeout=300,
                                     headers={"User-Agent": "mainstreetai-sim/1.0"})
                # A complete answer ends with </osm>; size alone is not the test,
                # because a tile over the sea is legitimately empty (~270 bytes).
                if resp.status_code == 200 and (len(resp.content) >= floor
                                                or resp.content.rstrip().endswith(b"</osm>")):
                    return resp.content
                print(f"[overpass] {url.split('/')[2]}: HTTP {resp.status_code}, "
                      f"{len(resp.content)} bytes")
            except requests.RequestException as exc:
                print(f"[overpass] {url.split('/')[2]}: {type(exc).__name__}")
    return None


def fetch_tiled(district: str, bbox, n: int) -> None:
    """
    A whole city district in one query failed on every mirror (502/504, and
    connections cut mid-response). n x n tiles each succeed; ways crossing a
    tile edge come back from both tiles, so nodes and ways are merged by id.
    """
    import xml.etree.ElementTree as ET
    s, w, nn, e = bbox
    dlat, dlon = (nn - s) / n, (e - w) / n
    nodes, ways = {}, {}
    for i in range(n):
        for j in range(n):
            tb = (s + i * dlat, w + j * dlon, s + (i + 1) * dlat, w + (j + 1) * dlon)
            # Each tile is kept, so a rerun after a network failure resumes.
            tile = NET_DIR / f"tiles_{district}" / f"{n}x{n}_{i}_{j}.osm.xml"
            tile.parent.mkdir(exist_ok=True)
            if tile.exists():
                raw = tile.read_bytes()
            else:
                raw = _post(build_query(tb), 2_000)
                if raw is None:
                    sys.exit(f"FATAL: tile {i * n + j + 1}/{n * n} failed on every mirror "
                             "(finished tiles are kept; run again to resume)")
                tile.write_bytes(raw)
            root = ET.fromstring(raw)
            for el in root:
                if el.tag == "node":
                    nodes[el.get("id")] = el
                elif el.tag == "way":
                    ways[el.get("id")] = el
            print(f"[overpass] tile {i * n + j + 1}/{n * n}: "
                  f"{len(nodes)} nodes, {len(ways)} ways so far")
    out = ET.Element("osm", version="0.6", generator="mainstreetai fetch_osm (tiled)")
    ET.SubElement(out, "bounds", minlat=str(s), minlon=str(w), maxlat=str(nn), maxlon=str(e))
    # netconvert wants nodes before the ways that use them.
    out.extend(sorted(nodes.values(), key=lambda x: int(x.get("id"))))
    out.extend(sorted(ways.values(), key=lambda x: int(x.get("id"))))
    path = NET_DIR / f"{district}.osm.xml"
    ET.ElementTree(out).write(path, encoding="utf-8", xml_declaration=True)
    print(f"[overpass] OK  {path.stat().st_size / 1e6:.1f} MB, "
          f"{len(nodes)} nodes, {len(ways)} ways -> {path}")


def fetch(district: str = "barcelona", tiles: int = 1) -> None:
    OSM_OUT = NET_DIR / f"{district}.osm.xml"
    BBOX = bbox_for(district)
    QUERY = build_query(BBOX)

    # A neighbourhood extract is legitimately far smaller than a city one, so
    # the "did we get a real response" floor has to scale with the request or
    # every district but Barcelona looks like a failed download.
    floor = 1_000_000 if district == "barcelona" else 100_000
    if OSM_OUT.exists() and OSM_OUT.stat().st_size > floor:
        mb = OSM_OUT.stat().st_size / 1e6
        print(f"[cache] {OSM_OUT.name} already present ({mb:.1f} MB) - skipping download.")
        print("        Delete the file to force a re-fetch.")
        return

    if tiles > 1:
        fetch_tiled(district, BBOX, tiles)
        return

    last_err = None
    for attempt, url in enumerate(ENDPOINTS, start=1):
        print(f"[overpass] mirror {attempt}/{len(ENDPOINTS)}: {url}")
        print(f"[overpass] bbox S={BBOX[0]} W={BBOX[1]} N={BBOX[2]} E={BBOX[3]}")
        try:
            t0 = time.time()
            resp = requests.post(
                url,
                data={"data": QUERY},
                timeout=420,
                headers={"User-Agent": "bcn-traffic-ai-hackathon/1.0"},
            )
            if resp.status_code != 200:
                last_err = f"HTTP {resp.status_code}"
                print(f"[overpass] {last_err} - trying next mirror")
                continue
            if len(resp.content) < floor // 10:
                last_err = f"suspiciously small response ({len(resp.content)} bytes)"
                print(f"[overpass] {last_err} - trying next mirror")
                continue

            OSM_OUT.write_bytes(resp.content)
            mb = len(resp.content) / 1e6
            print(f"[overpass] OK  {mb:.1f} MB in {time.time() - t0:.1f}s -> {OSM_OUT}")
            return
        except requests.RequestException as exc:
            last_err = str(exc)
            print(f"[overpass] {type(exc).__name__}: {exc} - trying next mirror")

    print(f"\nFATAL: every Overpass mirror failed. Last error: {last_err}", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--district", default="barcelona")
    ap.add_argument("--tiles", type=int, default=1,
                    help="split the box into N x N queries (a whole city district needs 4)")
    a = ap.parse_args()
    fetch(a.district, a.tiles)
