"""
Bake the illustrated basemap for each district.

This is the cheap half of "Try your city". A district is 4.6-8.5 km2 against
Barcelona's 51.8, so at the measured 22-54 s/km2 a bake is minutes rather than
the 26 it took for the full city.

WHAT THIS DOES NOT DO, AND WHY IT MATTERS
It bakes the MAP. It does not build a SUMO network, generate demand, or route
anything. A district with a basemap and no network renders the illustration and
no traffic, which the UI reports rather than presenting an empty city as if it
were a quiet one.

Building the traffic side per district means fetch_osm -> netconvert ->
randomTrips -> duarouter, then a twin pair holding the network in memory. That
is the long pole and it is deliberately a separate step.

    python sim/bake_districts.py                 # all unbaked districts
    python sim/bake_districts.py shibuya caba    # named only
"""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DATA = ROOT / "web" / "public" / "data"
PY = ROOT / ".venv-pipeline" / "Scripts" / "python.exe"

sys.path.insert(0, str(HERE))
from districts import DISTRICTS, BY_KEY  # noqa: E402


def bake(key: str, force: bool = False) -> bool:
    d = BY_KEY[key]
    png = DATA / f"basemap_{key}.png"
    if png.exists() and not force:
        print(f"[skip] {d.label}: already baked ({png.stat().st_size / 1e6:.1f} MB)")
        return True

    lon, lat = d.centre
    radius = d.radius_m()
    kw, kh = d.size_km()
    print(f"[bake] {d.label}  {kw:.1f} x {kh:.1f} km, radius {radius:.0f} m")

    t0 = time.time()
    s, w, n, e = d.bbox
    cmd = [
        str(PY), str(HERE / "basemap" / "build_basemap.py"),
        # "=" form, not a separate argv entry. Southern/western districts have
        # negative coordinates, and argparse reads a bare "-34.6,-58.37" as an
        # option name rather than a value -- which is why CABA was the only one
        # of the six to fail while the European and North American ones baked.
        f"--centre={lat},{lon}",
        f"--fit-bbox={s},{w},{n},{e}",
        "--radius", str(radius),
        "--px-per-m", "0.5",
        "--name", key,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    el = time.time() - t0
    if r.returncode != 0 or not png.exists():
        tail = (r.stderr or r.stdout or "").strip().splitlines()[-3:]
        print(f"[fail] {d.label} after {el:.0f}s")
        for line in tail:
            print(f"       {line}")
        return False
    print(f"[ok]   {d.label} in {el:.0f}s, {png.stat().st_size / 1e6:.1f} MB")
    return True


def main() -> None:
    keys = sys.argv[1:] or [d.key for d in DISTRICTS if d.key != "barcelona"]
    bad = [k for k in keys if k not in BY_KEY]
    if bad:
        raise SystemExit(f"unknown district(s): {', '.join(bad)}")

    print(f"baking {len(keys)} district(s)\n")
    ok = 0
    t0 = time.time()
    for k in keys:
        if bake(k):
            ok += 1
    print(f"\n{ok}/{len(keys)} baked in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
