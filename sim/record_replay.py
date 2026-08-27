"""
Record both twins to a compact binary the browser can replay with no server.

WHY A REPLAY EXISTS AT ALL
GitHub Pages serves static files. This app's traffic layer comes entirely from
a WebSocket to a Python process running SUMO, so a Pages deploy of the live app
would show a basemap and nothing else -- no vehicles, no signals, no stats.
That is worse than no link.

A recording is the honest alternative: it is the real simulation, really run,
played back. The page says so. What it cannot do is respond -- the AI toggle
switches between two pre-recorded twins rather than re-deciding, and that
limitation is stated on the page rather than hidden.

WIRE -> REPLAY, AND WHY IT SHRINKS
The live wire is float32 per field: 24 bytes a vehicle. At 1,400 vehicles and
4 Hz that is 5.6 MB a minute, which is not shippable.

Quantising against the known extent costs nothing visible:
    lon, lat   uint16 each, spanning the extent  -> ~0.13 m at this size,
                                                    far below one screen pixel
    angle      uint8, 360/256 = 1.4 deg          -> under the 5.6 deg the
                                                    sprite sheet already rounds to
    kind       uint8
    speed      uint8, 0.25 m/s steps to 63 m/s
    turn       int8, 1 deg steps, clamped +-90
That is 8 bytes a vehicle, a third of the wire, before gzip.

Signals are 0/1/2 per approach: packed two bits each, 3,230 lamps -> 808 bytes
a frame rather than 3,230.

    python sim/record_replay.py --seconds 60 --hz 4
"""

from __future__ import annotations

import argparse
import asyncio
import json
import struct
import time
from pathlib import Path

import numpy as np
import websockets

ROOT = Path(__file__).resolve().parent.parent
# Set per district in main(); Barcelona keeps the bare "replay" directory the
# deployed page has always fetched.
OUT = ROOT / "web" / "public" / "replay"
WS = "ws://127.0.0.1:8000/ws"
API = "http://127.0.0.1:8000/api"

STRIDE = 6            # lon, lat, angle, kind, speed, turn (float32 on the wire)
MAX_SPEED = 63.0      # m/s; nothing in this simulation approaches it
MAX_TURN = 90.0       # deg per tick, clamped


def parse(buf: bytes) -> tuple[dict, np.ndarray, bytes]:
    (hlen,) = struct.unpack_from("<I", buf, 0)
    header = json.loads(buf[4:4 + hlen].decode("utf-8"))
    off = 4 + hlen
    n_veh = header["n_veh"]
    veh = np.frombuffer(buf, dtype=np.float32, count=n_veh * STRIDE, offset=off)
    off += n_veh * STRIDE * 4
    sig = buf[off:off + header["n_sig"]]
    return header, veh.reshape(-1, STRIDE) if n_veh else np.zeros((0, STRIDE)), sig


def quantise(veh: np.ndarray, ext: tuple[float, float, float, float]) -> bytes:
    """Pack one frame of vehicles into 8 bytes each."""
    if not len(veh):
        return b""
    W, S, E, N = ext
    lon = np.clip((veh[:, 0] - W) / max(E - W, 1e-9), 0, 1) * 65535
    lat = np.clip((veh[:, 1] - S) / max(N - S, 1e-9), 0, 1) * 65535
    ang = np.mod(veh[:, 2], 360.0) / 360.0 * 255
    kind = np.clip(veh[:, 3], 0, 255)
    spd = np.clip(veh[:, 4] / MAX_SPEED, 0, 1) * 255
    turn = np.clip(veh[:, 5], -MAX_TURN, MAX_TURN)

    out = np.empty((len(veh), 8), dtype=np.uint8)
    u16 = lon.astype(np.uint16)
    out[:, 0] = u16 & 0xFF
    out[:, 1] = u16 >> 8
    u16 = lat.astype(np.uint16)
    out[:, 2] = u16 & 0xFF
    out[:, 3] = u16 >> 8
    out[:, 4] = ang.astype(np.uint8)
    out[:, 5] = kind.astype(np.uint8)
    out[:, 6] = spd.astype(np.uint8)
    out[:, 7] = turn.astype(np.int8).view(np.uint8)
    return out.tobytes()


def pack_signals(sig: bytes) -> bytes:
    """Two bits per lamp: 0 red, 1 amber, 2 green."""
    a = np.frombuffer(sig, dtype=np.uint8)
    if not len(a):
        return b""
    a = np.clip(a, 0, 3)
    pad = (-len(a)) % 4
    if pad:
        a = np.concatenate([a, np.zeros(pad, dtype=np.uint8)])
    q = a.reshape(-1, 4)
    return (q[:, 0] | (q[:, 1] << 2) | (q[:, 2] << 4) | (q[:, 3] << 6)).astype(np.uint8).tobytes()


async def set_focus(mode: str) -> None:
    import urllib.request
    req = urllib.request.Request(
        f"{API}/control", method="POST",
        data=json.dumps({"action": "focus", "value": mode}).encode(),
        headers={"Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=20).read()


async def record(mode: str, seconds: float, hz: float, ext) -> dict:
    await set_focus(mode)
    await asyncio.sleep(2.5)     # let the switch reach the stream

    period = 1.0 / hz
    frames: list[bytes] = []
    sigs: list[bytes] = []
    counts: list[int] = []
    next_at = 0.0
    t0 = time.time()
    n_sig = 0

    async with websockets.connect(WS, max_size=None) as ws:
        while time.time() - t0 < seconds:
            msg = await asyncio.wait_for(ws.recv(), timeout=60)
            if not isinstance(msg, bytes):
                continue
            now = time.time() - t0
            if now < next_at:
                continue
            next_at = now + period
            header, veh, sig = parse(msg)
            if header.get("focus") != mode:
                continue           # stream has not switched yet
            frames.append(quantise(veh, ext))
            sigs.append(pack_signals(sig))
            counts.append(len(veh))
            n_sig = header.get("n_sig", n_sig)
            print(f"\r  [{mode}] {len(frames):4d} frames  "
                  f"{counts[-1]:5d} veh", end="", flush=True)
    print()

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{mode}.veh.bin").write_bytes(b"".join(frames))
    (OUT / f"{mode}.sig.bin").write_bytes(b"".join(sigs))
    return {
        "frames": len(frames),
        "counts": counts,
        "n_sig": n_sig,
        "veh_bytes": sum(len(f) for f in frames),
        "sig_bytes": sum(len(s) for s in sigs),
    }


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seconds", type=float, default=60.0)
    ap.add_argument("--hz", type=float, default=4.0)
    ap.add_argument("--district", default="barcelona")
    args = ap.parse_args()

    global OUT
    if args.district != "barcelona":
        OUT = ROOT / "web" / "public" / f"replay_{args.district}"
    OUT.mkdir(parents=True, exist_ok=True)

    meta_path = (ROOT / "web" / "public" / "data"
                 / f"basemap_{args.district}.json")
    base = json.loads(meta_path.read_text(encoding="utf-8"))
    ext = tuple(base["sim_extent"])

    import urllib.request
    twins = json.loads(urllib.request.urlopen(f"{API}/twins", timeout=20).read())

    print(f"recording {args.seconds:.0f}s at {args.hz:.0f} Hz per twin")
    out = {}
    for mode in ("ai", "baseline"):
        out[mode] = await record(mode, args.seconds, args.hz, ext)

    manifest = {
        "extent": list(ext),
        "hz": args.hz,
        "max_speed": MAX_SPEED,
        "max_turn": MAX_TURN,
        "stride": 8,
        "basemap": base["png"],
        "lonlat_to_px": base["lonlat_to_px"],
        "width_px": base["width_px"],
        "height_px": base["height_px"],
        "px_per_m": base["px_per_m"],
        "twins": {m: {k: v for k, v in out[m].items() if k != "counts"}
                  for m in out},
        "frame_counts": {m: out[m]["counts"] for m in out},
        "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        # The comparison the page quotes, taken at record time so the replay
        # cannot drift from the numbers printed beside it.
        # co2_kg and p95_wait_s are here because the deployed impact panel
        # quotes them. Leaving them out meant two of its four figures rendered
        # as an em dash on the static build while looking fine locally, where
        # the live API supplies them.
        "stats": {m: {k: twins[m].get(k) for k in
                      ("avg_speed_kmh", "bus_avg_speed_kmh",
                       "stopped_veh_hours", "completed", "sim_time",
                       "co2_kg", "p95_wait_s")}
                  for m in ("ai", "baseline") if m in twins},
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    total = sum(out[m]["veh_bytes"] + out[m]["sig_bytes"] for m in out)
    print()
    for m in out:
        o = out[m]
        avg = sum(o["counts"]) / max(len(o["counts"]), 1)
        print(f"  {m:<9} {o['frames']:4d} frames  avg {avg:6.0f} veh  "
              f"{(o['veh_bytes'] + o['sig_bytes']) / 1e6:5.2f} MB")
    print(f"  total    {total / 1e6:.2f} MB (before gzip)")


if __name__ == "__main__":
    asyncio.run(main())
