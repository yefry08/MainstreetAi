"""
Generate one signal lamp per APPROACH instead of one per junction.

Why this file exists
--------------------
The map used to draw a single lamp at each of Barcelona's 1,151 signalised
junctions, coloured by "is any link here green". That is not a signal state.
Measured over 340 simulated seconds on the real network:

  * 1,144 of 1,151 junctions (99%) cycle their per-link state correctly --
    the controller was never the problem
  * 94% of samples at multi-approach junctions have approaches that DISAGREE
    with each other, which is the normal, correct behaviour of a traffic
    signal and precisely what one lamp per junction cannot express
  * one real junction cycles through 17 distinct phases, every one of which
    collapsed to the same green byte

So the junction lamp was showing an unchanging green while the signals
underneath it ran a perfectly good cycle. This script emits the geometry the
map needs to show the truth: one lamp at each approach's stop line, coloured
by the state of the links arriving from that approach. Opposing approaches
then visibly differ, which is the whole point of a traffic signal.

Output: web/public/data/signal_approaches.geojson, ~3,230 features.
The worker emits one state byte per feature IN THIS FILE'S ORDER, so the file
and the wire format must be regenerated together.

    python sim/build_signal_approaches.py
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import libsumo as ls

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
import argparse as _argparse

_ap = _argparse.ArgumentParser()
_ap.add_argument("--district", default="barcelona")
DISTRICT = _ap.parse_known_args()[0].district

# Barcelona keeps the unsuffixed filenames the renderer has always fetched.
_sfx = "" if DISTRICT == "barcelona" else f"_{DISTRICT}"
NET = HERE / "net" / f"{DISTRICT}.net.xml"
OUT = ROOT / "web" / "public" / "data" / f"signal_approaches{_sfx}.geojson"
SIGNALS = ROOT / "web" / "public" / "data" / f"signals{_sfx}.geojson"

# How far back from the stop line to seat the lamp, in metres. A lamp exactly
# on the stop line sits in the middle of the junction box once it is scaled up
# for visibility, which reads as a light floating in the intersection.
SETBACK_M = 3.0


def main() -> None:
    if not NET.exists():
        raise SystemExit(f"network not found: {NET}")

    # No route files: the geometry does not depend on demand, and loading a
    # day of traffic to read lane shapes would waste a minute per run.
    ls.start(["sumo", "-n", str(NET), "--no-step-log", "true",
              "--no-warnings", "true"])

    # Keep the junction ORDER of signals.geojson so anything still keyed on
    # junction index (the click-to-inspect panel, the corridor stats) keeps
    # lining up with the new file.
    if SIGNALS.exists():
        tls_ids = [f["properties"]["id"]
                   for f in json.loads(SIGNALS.read_text(encoding="utf-8"))["features"]]
    else:
        tls_ids = list(ls.trafficlight.getIDList())

    features = []
    skipped = 0

    for tid in tls_ids:
        try:
            links = ls.trafficlight.getControlledLinks(tid)
        except Exception:
            skipped += 1
            continue

        # Group link indices by the incoming EDGE. Grouping by lane instead
        # would put three lamps across one carriageway, which is visual noise
        # at map scale; an approach is what a driver reads.
        groups: dict[str, list[int]] = defaultdict(list)
        lanes: dict[str, set[str]] = defaultdict(set)
        for idx, conns in enumerate(links):
            if not conns:
                continue
            in_lane = conns[0][0]
            edge = in_lane.rsplit("_", 1)[0]
            groups[edge].append(idx)
            lanes[edge].add(in_lane)

        for edge, idxs in groups.items():
            # Average the stop-line points of every lane on this approach, so
            # the lamp sits at the centre of the carriageway rather than on
            # whichever lane happened to be listed first.
            ends: list[tuple[float, float]] = []
            heads: list[tuple[float, float]] = []
            for lane in sorted(lanes[edge]):
                try:
                    shape = ls.lane.getShape(lane)
                except Exception:
                    continue
                if len(shape) < 2:
                    continue
                x1, y1 = shape[-2][0], shape[-2][1]
                x2, y2 = shape[-1][0], shape[-1][1]
                ends.append((x2, y2))
                heads.append((x2 - x1, y2 - y1))

            if not ends:
                skipped += 1
                continue

            cx = sum(p[0] for p in ends) / len(ends)
            cy = sum(p[1] for p in ends) / len(ends)
            dx = sum(h[0] for h in heads) / len(heads)
            dy = sum(h[1] for h in heads) / len(heads)
            norm = (dx * dx + dy * dy) ** 0.5
            if norm > 1e-6:
                cx -= dx / norm * SETBACK_M
                cy -= dy / norm * SETBACK_M

            try:
                lon, lat = ls.simulation.convertGeo(cx, cy)
            except Exception:
                skipped += 1
                continue

            # Bearing the approaching driver is travelling, degrees clockwise
            # from north -- lets the renderer aim the lamp back down the road.
            import math
            bearing = (math.degrees(math.atan2(dx, dy)) + 360.0) % 360.0 if norm > 1e-6 else 0.0

            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]},
                "properties": {
                    "tls": tid,
                    "edge": edge,
                    "links": idxs,
                    "bearing": round(bearing, 1),
                },
            })

    ls.close()

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": features}),
                   encoding="utf-8")

    per_j: dict[str, int] = defaultdict(int)
    for f in features:
        per_j[f["properties"]["tls"]] += 1

    print(f"{len(features)} approach lamps across {len(per_j)} junctions")
    print(f"  mean approaches per junction : {len(features) / max(len(per_j), 1):.2f}")
    print(f"  skipped (no usable geometry) : {skipped}")
    print(f"  wrote {OUT.relative_to(ROOT)} "
          f"({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
