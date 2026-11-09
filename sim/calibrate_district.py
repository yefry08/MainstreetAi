"""
Calibrate a district twin's demand against its real peak-hour congestion.

    python sim/calibrate_district.py --district santo_domingo --slug santo-domingo

Needs the twin server running for the district (MAINSTREET_DISTRICT=...) and
at least one Mapbox snapshot taken at the real peak
(web/scripts/snapshot-traffic.mjs -> web/.cache/traffic/<slug>.json).

THE MEASURE, ON BOTH SIDES: the share of main-road length that is congested.
  Mapbox  -- road length tagged moderate, heavy or severe, over all main roads.
  Twin    -- road length of main edges running below CONGESTED_RATIO of their
             speed limit, on the FIXED-TIME twin (today's city), read from the
             server's live frames (per-edge speed/limit, roads.geojson order).
Mapbox's levels are against free-flow speed and the twin's ratio is against
the limit, so the two are matched on a share, not on speeds, and the result is
an approximate calibration -- said so wherever it is quoted.

THE LEVER: the server's demand scale (both twins together). Each candidate is
held until the network settles, then measured over several frames; the scale
whose congested share is nearest the real one is reported.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import struct
import time
import urllib.request
from pathlib import Path

import websockets

ROOT = Path(__file__).resolve().parent.parent
API = "http://127.0.0.1:8000/api"
WS = "ws://127.0.0.1:8000/ws"
MAIN_TIERS = {"motorway", "trunk", "arterial", "primary", "secondary", "collector", "tertiary"}
CONGESTED_RATIO = 0.5


def post(action: str, **kw) -> dict:
    req = urllib.request.Request(f"{API}/control", data=json.dumps({"action": action, **kw}).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=20).read())


def twins() -> dict:
    return json.loads(urllib.request.urlopen(f"{API}/twins", timeout=20).read())


async def congested_share(roads: list[dict], frames: int = 8) -> float:
    """Length share of main edges below CONGESTED_RATIO, averaged over frames."""
    main = [i for i, r in enumerate(roads) if r["tier"] in MAIN_TIERS]
    total = sum(roads[i]["len"] for i in main) or 1.0
    shares = []
    async with websockets.connect(WS, max_size=None) as ws:
        while len(shares) < frames:
            msg = await asyncio.wait_for(ws.recv(), timeout=120)
            if isinstance(msg, str):
                continue
            hlen = struct.unpack_from("<I", msg, 0)[0]
            header = json.loads(msg[4:4 + hlen].decode("utf-8").rstrip("\x00 "))
            off = 4 + hlen
            n_veh = header.get("n_veh", 0)
            n_sig = header.get("n_sig", 0)
            off += n_veh * 6 * 4 + n_sig
            n_edge = header.get("n_edge", 0)
            if n_edge != len(roads):
                raise SystemExit(f"[abort] server sends {n_edge} edges, roads file has {len(roads)}: "
                                 "is it running this district?")
            ratios = msg[off:off + n_edge]
            slow = sum(roads[i]["len"] for i in main if ratios[i] / 255.0 < CONGESTED_RATIO)
            shares.append(slow / total)
    return sum(shares) / len(shares)


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--district", default="santo_domingo")
    ap.add_argument("--slug", default="santo-domingo")
    ap.add_argument("--hour", type=float, default=7.75)
    ap.add_argument("--scales", default="1.0,1.4,1.8,2.2,2.6")
    ap.add_argument("--settle", type=float, default=420, help="simulated seconds to settle each scale")
    args = ap.parse_args()

    snaps = json.loads((ROOT / "web" / ".cache" / "traffic" / f"{args.slug}.json").read_text(encoding="utf-8"))
    peak = [s for s in snaps if 7 <= int(s["local"][11:13]) <= 9 and 1 <= s["day"] <= 5]
    if not peak:
        raise SystemExit("[abort] no weekday 07-09h snapshot yet; take one at the real peak first")
    target = sum(s["congested"] for s in peak) / len(peak)
    print(f"real peak (Mapbox, {len(peak)} snapshot(s)): {target * 100:.1f}% of main-road length congested")

    roads = [f["properties"] for f in json.loads(
        (ROOT / "web" / "public" / "data" / f"roads_{args.district}.geojson").read_text(encoding="utf-8"))["features"]]

    post("focus", value="baseline")                     # measure today's city
    post("clock", hour=args.hour)
    results = []
    for s in [float(x) for x in args.scales.split(",")]:
        post("scale", value=s)
        t0 = twins()["baseline"]["sim_time"]
        while twins()["baseline"]["sim_time"] - t0 < args.settle:
            time.sleep(5)
        share = await congested_share(roads)
        t = twins()
        results.append((s, share))
        print(f"  scale {s:.2f}: twin {share * 100:5.1f}% congested  "
              f"(fixed {t['baseline']['avg_speed_kmh']:.1f} km/h, {t['baseline']['running']} veh; "
              f"AI {t['ai']['avg_speed_kmh']:.1f} km/h)")
    best = min(results, key=lambda r: abs(r[1] - target))
    out = {"district": args.district, "target": target, "snapshots": peak, "trials": results,
           "scale": best[0], "twin_share": best[1], "hour": args.hour,
           "method": f"main-road length share below {CONGESTED_RATIO} of limit (twin) vs Mapbox moderate+ (real)",
           "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    (ROOT / "sim" / "net" / f"calibration_{args.district}.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"\ncalibrated scale {best[0]:.2f}: twin {best[1] * 100:.1f}% vs real {target * 100:.1f}%")
    post("scale", value=best[0])
    post("focus", value="ai")


if __name__ == "__main__":
    asyncio.run(main())
