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

import sys
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
NET_DIR = HERE / "net"
NET_DIR.mkdir(parents=True, exist_ok=True)
OSM_OUT = NET_DIR / "barcelona.osm.xml"

# south, west, north, east  -- roughly 7.9 km (E-W) x 6.1 km (N-S)
BBOX = (41.3650, 2.1150, 41.4200, 2.2100)

# Road tiers we import. Keeping residential in gives us the authentic Eixample
# chamfered-block grid; without it Barcelona stops looking like Barcelona.
HIGHWAY_RE = (
    r"^(motorway|trunk|primary|secondary|tertiary|"
    r"unclassified|residential|living_street)(_link)?$"
)

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
]

QUERY = f"""
[out:xml][timeout:300];
(
  way["highway"~"{HIGHWAY_RE}"]["area"!~"yes"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  node["highway"="traffic_signals"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
);
(._;>;);
out body;
"""


def fetch() -> None:
    if OSM_OUT.exists() and OSM_OUT.stat().st_size > 1_000_000:
        mb = OSM_OUT.stat().st_size / 1e6
        print(f"[cache] {OSM_OUT.name} already present ({mb:.1f} MB) - skipping download.")
        print("        Delete the file to force a re-fetch.")
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
            if len(resp.content) < 100_000:
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
    fetch()
