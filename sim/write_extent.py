"""
Write a district's extent sidecar without baking an illustrated basemap.

    python sim/write_extent.py --district santo_domingo

record_replay.py reads web/public/data/basemap_<district>.json for two things:
`sim_extent` (the box vehicle positions are quantised against) and
`lonlat_to_px` (where to draw them on the illustrated pixel basemap). The 3D
scene uses only the first. Baking the illustration for a whole city district
is the 25-60 minute prettymaps run (sim/cities.py), for an image nothing on the
site shows -- so this writes the sidecar with the real extent and an exact
LINEAR transform onto an imaginary 0.5 px/m canvas, and `png: null` to say
there is no picture. The quadratic basis is kept so transform.js reads it as is.
"""

import argparse
import json
import math
from pathlib import Path

from districts import BY_KEY

ROOT = Path(__file__).resolve().parent.parent
PX_PER_M = 0.5

ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument("--district", required=True)
d = BY_KEY[ap.parse_args().district]
s, w, n, e = d.bbox
m_lat = 110540.0
m_lon = 111320.0 * math.cos(math.radians((s + n) / 2))
kx_s, ky_s = m_lon * PX_PER_M, m_lat * PX_PER_M
meta = {
    "png": None,
    "note": "Extent only: no illustrated basemap was baked (see sim/write_extent.py).",
    "width_px": round((e - w) * kx_s), "height_px": round((n - s) * ky_s),
    "px_per_m": PX_PER_M,
    "sim_extent": [w, s, e, n],
    "lonlat_to_px": {
        "kx": [-w * kx_s, kx_s, 0.0, 0.0, 0.0, 0.0],
        "ky": [n * ky_s, 0.0, -ky_s, 0.0, 0.0, 0.0],
        "basis": ["1", "lon", "lat", "lon*lon", "lon*lat", "lat*lat"],
        "max_error_px": 0.0, "fitted_over": [w, s, e, n],
    },
}
out = ROOT / "web" / "public" / "data" / f"basemap_{d.key}.json"
out.write_text(json.dumps(meta, indent=2), encoding="utf-8")
print(f"[ok] {out.name}: extent {meta['sim_extent']}, {meta['width_px']} x {meta['height_px']} px")
