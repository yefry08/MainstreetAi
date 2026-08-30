"""
Warm the simulation to its calibrated operating point and record, in one run.

WHY THIS IS ONE SCRIPT AND NOT TWO STEPS
The simulation keeps running in wall-clock time whatever else is happening.
A first attempt warmed it to 1,885 simulated seconds -- 1,194 vehicles, +39.6%
network speed, exactly the validated point -- and then recorded a while later.
By then 68 minutes of wall clock had passed at 5x, the clock had reached 6.4
simulated hours, and the recording captured 5,200 vehicles at +12.7%: the
drifted state documented in the README, not the state the numbers were
validated at.

Publishing that would have shown a third of the real result. So warmup and
capture happen back to back here, with no human-shaped gap between them.

    python sim/bake_replay.py --target 1800 --seconds 45 --hz 4
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
API = "http://127.0.0.1:8000/api"


def twins() -> dict | None:
    try:
        return json.loads(urllib.request.urlopen(f"{API}/twins", timeout=15).read())
    except Exception:
        return None


def gain(t: dict) -> float:
    a, b = t["ai"]["avg_speed_kmh"], t["baseline"]["avg_speed_kmh"]
    return 100.0 * (a - b) / b if b else 0.0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--target", type=float, default=1800.0,
                    help="simulated seconds to warm to before recording")
    ap.add_argument("--seconds", type=float, default=45.0)
    ap.add_argument("--hz", type=float, default=4.0)
    ap.add_argument("--timeout", type=float, default=1500.0)
    ap.add_argument("--district", default="barcelona")
    args = ap.parse_args()

    print(f"waiting for the simulation to reach t={args.target:.0f}s")
    t0 = time.time()
    last = None
    while time.time() - t0 < args.timeout:
        t = twins()
        if t and "ai" in t:
            st = t["ai"]["sim_time"]
            if last is None or st - last > 150:
                last = st
                print(f"  t={st:7.0f}s  running={t['ai']['running']:5d}  "
                      f"gain={gain(t):+5.1f}%")
            if st >= args.target:
                break
        time.sleep(5)
    else:
        sys.exit("[abort] simulation never reached the target — is the server up?")

    t = twins()
    print(f"\nrecording NOW at t={t['ai']['sim_time']:.0f}s, "
          f"{t['ai']['running']} vehicles, {gain(t):+.1f}% network speed")

    # Straight into the recorder: every second spent here is simulated time the
    # recording will not represent.
    r = subprocess.run(
        [sys.executable, str(HERE / "record_replay.py"),
         "--district", args.district,
         "--seconds", str(args.seconds), "--hz", str(args.hz)],
        cwd=str(ROOT))
    if r.returncode != 0:
        sys.exit(f"[abort] recorder failed ({r.returncode})")

    # Read back the manifest for the district actually recorded. This was
    # pinned to Barcelona's, so a Shibuya bake printed Barcelona's numbers --
    # and, worse, ran the sanity check below against them, which would have
    # waved through a Shibuya recording captured at a dead moment.
    _dir = "replay" if args.district == "barcelona" else f"replay_{args.district}"
    man = json.loads((ROOT / "web" / "public" / _dir / "manifest.json")
                     .read_text(encoding="utf-8"))
    s = man["stats"]
    g = 100 * (s["ai"]["avg_speed_kmh"] - s["baseline"]["avg_speed_kmh"]) / \
        max(s["baseline"]["avg_speed_kmh"], 0.01)
    print(f"\ncaptured at sim_time {s['ai']['sim_time']:.0f}s, "
          f"network speed {g:+.1f}%")
    if g < 25:
        print("  !! well below the validated +38% — the simulation had already "
              "drifted. Restart the server and run this again.")


if __name__ == "__main__":
    main()
