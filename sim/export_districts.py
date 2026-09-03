"""
Write districts.json for the static build.

The Pages and Vercel deploys have no Python, so the district registry has to
travel with the bundle. This emits the same shape /api/districts serves, plus
the on-disk state of each artefact so the UI can say "map only" rather than
rendering an empty city as if it were a quiet one.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DATA = ROOT / "web" / "public" / "data"
NET = ROOT / "sim" / "net"
WEB = ROOT / "web" / "public" / "data"

sys.path.insert(0, str(HERE))
from districts import DISTRICTS, summary  # noqa: E402


def state(key: str) -> dict:
    basemap = (DATA / f"basemap_{key}.png").exists()
    meta_p = DATA / f"basemap_{key}.json"
    transform = False
    if meta_p.exists():
        try:
            transform = bool(json.loads(meta_p.read_text(encoding="utf-8"))
                             .get("lonlat_to_px"))
        except Exception:
            transform = False
    net = (NET / ("barcelona.net.xml" if key == "barcelona"
                  else f"{key}.net.xml")).exists()
    return {
        # A basemap without its transform sidecar cannot be drawn on, so it does
        # not count as having a basemap.
        "has_basemap": basemap and transform,
        "has_network": net,
        # A plain-GeoJSON export of the street graph. It is what an outside GIS
        # viewer can open directly, so it gates the "explore elsewhere" link.
        "has_roads_geojson": (WEB / ("roads.geojson" if key == "barcelona"
                                     else f"roads_{key}.geojson")).exists(),
    }


def main() -> None:
    out = {"districts": [{**d, **state(d["key"])} for d in summary()],
           "default": "barcelona"}
    p = ROOT / "web" / "public" / "districts.json"
    p.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"[ok] {p.relative_to(ROOT)}")
    for d in out["districts"]:
        s = ("traffic+map" if d["has_network"]
             else "map only" if d["has_basemap"] else "not built")
        print(f"   {d['label']:<34} {s}")


if __name__ == "__main__":
    main()
