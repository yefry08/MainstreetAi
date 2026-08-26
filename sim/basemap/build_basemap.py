"""
Render the illustrated 2D base map with prettymaps, and record the transform
that lets the simulation be drawn on top of it.

THE PART THAT MATTERS MOST IS THE SIDECAR, NOT THE IMAGE
--------------------------------------------------------
Step 3 composites moving vehicles onto this picture, so it needs an exact
lon/lat -> pixel mapping. prettymaps hands back the matplotlib axes, and the
axes limits are the transform -- but they are NOT in the same CRS as the
GeoDataFrames it also returns. Measured on this machine: every layer reports
`EPSG:4326`, while the axes read x 428961..430413, y 4581534..4582986, which
is UTM. Taking the layer CRS at face value would put every vehicle several
hundred kilometres out to sea, and it would look like a bug in the renderer.

Verified by projecting the requested centre into UTM 31N: it lands on the axes
centre with an offset of (0.0, 0.0) m.

osmnx picks the LOCAL UTM zone, so the CRS is a property of the render and
changes from city to city. It is written into the sidecar rather than assumed,
which is what makes step 4 possible at all.

COST
----
Render time scales linearly with area. Measured:

    radius  500 m   2.11 km2    49.5 s
    radius 1000 m   7.09 km2   154.7 s

Barcelona's simulated extent is 51.2 km2, so a full render is roughly 19
minutes, dominated by the Overpass fetch rather than by drawing. That is a
one-time pre-bake per city; it is not something to do while a user waits.

    python sim/basemap/build_basemap.py                    # sim extent
    python sim/basemap/build_basemap.py --radius 1200      # quick preview
    python sim/basemap/build_basemap.py --place "Lisbon, Portugal" --radius 2500
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # before pyplot: no display in a build script
import matplotlib.pyplot as plt  # noqa: E402
import prettymaps  # noqa: E402
from pyproj import Transformer  # noqa: E402

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
DATA = ROOT / "web" / "public" / "data"

# Ground resolution. 1 px/m puts the whole 8.0 x 6.4 km extent at 8000 x 6400,
# which a browser handles as a normal image; the probe's 2.4 px/m would make it
# 300 megapixels. For a 2D sim viewed at city scale this is already generous.
DEFAULT_PX_PER_M = 1.0


def sim_extent() -> tuple[float, float, float, float]:
    """(W, S, E, N) of the simulation, from the signal lamps.

    The lamps are where the network actually ended up, whereas meta.json holds
    the bbox it was REQUESTED with. Rendering the requested box would leave a
    sliver of simulated street with no map under it.
    """
    sig = json.loads((DATA / "signal_approaches.geojson").read_text(encoding="utf-8"))
    lons = [f["geometry"]["coordinates"][0] for f in sig["features"]]
    lats = [f["geometry"]["coordinates"][1] for f in sig["features"]]
    return min(lons), min(lats), max(lons), max(lats)


def render(query, radius: float, preset: str, px_per_m: float,
           out_png: Path, out_json: Path,
           centre_lonlat: tuple[float, float] | None = None) -> dict:
    t0 = time.time()
    plot = prettymaps.plot(query, preset=preset, radius=radius,
                           circle=False, save_as=None)
    fetch_draw_s = time.time() - t0

    ax, fig = plot.ax, plot.fig
    xlim, ylim = ax.get_xlim(), ax.get_ylim()
    width_m = float(xlim[1] - xlim[0])
    height_m = float(ylim[1] - ylim[0])

    # Size the figure so one inch is a known number of metres, then dpi fixes
    # the pixel count. Doing it this way makes ground resolution explicit
    # rather than an accident of the default figsize.
    px_w = max(1, int(round(width_m * px_per_m)))
    px_h = max(1, int(round(height_m * px_per_m)))
    dpi = 100
    fig.set_size_inches(px_w / dpi, px_h / dpi)
    ax.set_position([0, 0, 1, 1])   # no margins: pixel 0 is the axes corner
    ax.set_xlim(*xlim)
    ax.set_ylim(*ylim)
    ax.set_axis_off()

    t1 = time.time()
    fig.savefig(out_png, dpi=dpi, pad_inches=0,
                facecolor=fig.get_facecolor())
    save_s = time.time() - t1
    plt.close(fig)

    # Which projection are those axes in? Try the plausible candidates and keep
    # whichever puts the extent's own centre on the axes centre. Guessing would
    # be silently wrong rather than loudly wrong.
    crs = "unknown"
    if centre_lonlat is not None:
        cx, cy = (xlim[0] + xlim[1]) / 2, (ylim[0] + ylim[1]) / 2
        clon, clat = centre_lonlat
        best, best_err = None, float("inf")
        for cand in ("EPSG:32629", "EPSG:32630", "EPSG:32631", "EPSG:32632",
                     "EPSG:32633", "EPSG:3857"):
            try:
                tx = Transformer.from_crs("EPSG:4326", cand, always_xy=True)
                x, y = tx.transform(clon, clat)
            except Exception:
                continue
            err = abs(x - cx) + abs(y - cy)
            if err < best_err:
                best, best_err = cand, err
        crs = best if best_err < 1.0 else f"{best}?err={best_err:.1f}m"

    meta = {
        "png": out_png.name,
        "crs": crs,
        "xlim": [float(xlim[0]), float(xlim[1])],
        "ylim": [float(ylim[0]), float(ylim[1])],
        "width_px": px_w,
        "height_px": px_h,
        "px_per_m": px_per_m,
        "width_m": round(width_m, 1),
        "height_m": round(height_m, 1),
        "preset": preset,
        "layers": {k: len(v) for k, v in plot.geodataframes.items()},
        "render_s": round(fetch_draw_s, 1),
        "save_s": round(save_s, 1),
    }
    out_json.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return meta


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--place", type=str, default=None,
                    help="city name; default is the simulated extent")
    ap.add_argument("--radius", type=float, default=None,
                    help="metres; smaller renders are far faster")
    ap.add_argument("--preset", type=str, default="barcelona")
    ap.add_argument("--px-per-m", type=float, default=DEFAULT_PX_PER_M)
    ap.add_argument("--name", type=str, default="barcelona")
    args = ap.parse_args()

    DATA.mkdir(parents=True, exist_ok=True)
    out_png = DATA / f"basemap_{args.name}.png"
    out_json = DATA / f"basemap_{args.name}.json"

    centre = None
    if args.place:
        query = args.place
        radius = args.radius or 2000
    else:
        W, S, E, N = sim_extent()
        centre = ((W + E) / 2, (S + N) / 2)
        # prettymaps CANNOT take a bounding box. Its get_boundary() treats any
        # tuple as a (lat, lon) POINT -- literally Point(point[::-1]) -- so a
        # 4-tuple raises "ordinate dimension should be 2 or 3, got 4". Centre
        # plus radius is the only geometric input it accepts, which means the
        # render is always SQUARE even when the extent is not.
        query = (centre[1], centre[0])   # (lat, lon), the order it expects
        half_w = (E - W) * 84900 / 2
        half_h = (N - S) * 111320 / 2
        # Half the LONGER side, so the square covers the whole extent. It
        # over-renders the short axis; that is the cost of the square.
        radius = args.radius or max(half_w, half_h)
        print(f"sim extent  lon {W:.4f}..{E:.4f}  lat {S:.4f}..{N:.4f}"
              f"   ({(E-W)*84.9:.1f} x {(N-S)*111.3:.1f} km)")
        print(f"            square render of {2*radius/1000:.1f} km per side "
              f"({(2*radius/1000)**2:.0f} km2 vs {(E-W)*84.9*(N-S)*111.3:.0f} km2 needed)")

    print(f"rendering   preset={args.preset} radius={radius:.0f} m "
          f"at {args.px_per_m} px/m  -- this is slow, see the module docstring")

    meta = render(query, radius, args.preset, args.px_per_m, out_png, out_json,
                  centre_lonlat=centre)
    if centre:
        meta["sim_extent"] = list(sim_extent())
        out_json.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    mb = out_png.stat().st_size / 1e6
    print(f"[ok] {out_png.name}: {meta['width_px']} x {meta['height_px']} px, {mb:.1f} MB")
    print(f"     CRS       {meta['crs']}")
    print(f"     ground    {meta['width_m']:.0f} x {meta['height_m']:.0f} m")
    print(f"     render    {meta['render_s']:.0f}s   save {meta['save_s']:.0f}s")
    print(f"     layers    {meta['layers']}")
    if meta["crs"].endswith("?") or "err=" in meta["crs"]:
        print("     !! CRS could not be pinned exactly -- do NOT composite on "
              "this until it can, the offset would look like a renderer bug.")


if __name__ == "__main__":
    main()
