"""
Generate traffic demand for the Barcelona network.

*** SYNTHETIC DATA -- READ THIS ***
Barcelona does not publish an open origin-destination matrix, so the individual
trips here are generated statistically, not observed. What IS grounded in
reality:

  * every trip runs on the real OSM street network, obeying real oneway rules,
    real lane counts and real bus/bike-lane permissions;
  * the mode split is calibrated to the Ajuntament de Barcelona published modal
    share for motorised street traffic;
  * `--fringe-factor` biases trip ends toward the edge of the extract, which
    reproduces the through-traffic pattern of a city-centre cordon;
  * emissions are computed by SUMO's HBEFA3 model from the resulting speed and
    acceleration traces.

The UI labels this demand as synthetic. Do not present these absolute vehicle
counts as measured Barcelona traffic volumes.
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

import sumolib

HERE = Path(__file__).resolve().parent
NET_DIR = HERE / "net"
NET = NET_DIR / "barcelona.net.xml"
TOOLS = Path(sumolib.__file__).resolve().parent.parent / "sumo" / "tools"
RANDOM_TRIPS = TOOLS / "randomTrips.py"

# Mode split by AGENT COUNT, shaped to Barcelona rather than to a generic city.
#
# The two that make it read as Barcelona specifically:
#   moto   roughly a third of the city's vehicle fleet is two-wheeled, a share
#          almost no other European city approaches
#   truck  urban freight, which is a small count but a large share of the
#          disruption because vans stop on the carriageway
#
# Buses are deliberately few — around 8% of agents — because that is the point:
# a handful of vehicles carrying a large share of the people, which is what
# makes signal priority for them such a high-leverage lever.
# These periods define the PEAK hour. The simulation scales insertion down from
# here with SUMO's own `setScale`, driven by the measured demand curve — so this
# is the busiest the network ever gets, not its average.
#
# Total is held near 9,000 trips/hour because that is what the network was
# validated at. The first version of this table simply added motos and trucks on
# top of the existing car demand, which pushed it to 11,000, gridlocked the
# Eixample, and drove SUMO from 0.2 s to 6 s per simulated second. Composition
# changed; volume should not have.
MODES = {
    #  name     vclass          vType    period  fringe  min_dist   share
    "car":   dict(vclass="passenger",  vtype="car",   period=0.80, fringe=8.0, min_dist=600),   # ~50%
    "moto":  dict(vclass="motorcycle", vtype="moto",  period=1.45, fringe=6.0, min_dist=450),   # ~28%
    "bike":  dict(vclass="bicycle",    vtype="bike",  period=3.30, fringe=3.0, min_dist=400),   # ~12%
    "truck": dict(vclass="delivery",   vtype="truck", period=6.70, fringe=4.0, min_dist=900),   # ~6%
    "bus":   dict(vclass="bus",        vtype="bus",   period=10.0, fringe=1.5, min_dist=1800),  # ~4%
}


def generate(mode: str, cfg: dict, end: int, seed: int, tag: str = "") -> Path:
    trips = NET_DIR / f"{mode}{tag}.trips.xml"
    routes = NET_DIR / f"{mode}{tag}.rou.xml"

    attrs = f'type="{cfg["vtype"]}" departLane="best" departSpeed="max"'

    cmd = [
        sys.executable, str(RANDOM_TRIPS),
        "-n", str(NET),
        "-o", str(trips),
        "-r", str(routes),
        "-b", "0",
        "-e", str(end),
        "-p", str(cfg["period"]),
        "--fringe-factor", str(cfg["fringe"]),
        "--min-distance", str(cfg["min_dist"]),
        # --edge-permission (not --vehicle-class) filters origin/destination edges
        # by vClass while leaving the `type` attribute free for our own vTypes,
        # which is what carries the HBEFA3 emission classes.
        "--edge-permission", cfg["vclass"],
        # The vehicle-id prefix must stay `mode` regardless of the tag: the
        # simulation classifies cars/buses/bikes by id prefix.
        "--prefix", mode,
        "--trip-attributes", attrs,
        "--additional-file", str(HERE / "vtypes.add.xml"),
        "--seed", str(seed),
        "--validate",
        "--remove-loops",
    ]

    print(f"\n=== demand: {mode} (period={cfg['period']}s, vclass={cfg['vclass']}) ===")
    env = dict(os.environ)
    env["SUMO_HOME"] = str(TOOLS.parent)
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
    for line in (proc.stdout or "").strip().splitlines()[-6:]:
        print("  |", line)
    if proc.returncode != 0:
        print("  ! stderr:", (proc.stderr or "")[-2500:], file=sys.stderr)
        sys.exit(f"randomTrips failed for {mode}")

    n = routes.read_text(encoding="utf-8").count("<vehicle ")
    print(f"  -> {routes.name}: {n} {mode} trips")
    return routes


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--end", type=int, default=3600, help="seconds of demand to generate")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--tag", default="",
                    help="suffix for an alternate demand set, e.g. --tag _b "
                         "produces car_b.rou.xml. Used by validate_seeds.py to "
                         "test against genuinely different traffic rather than "
                         "just a different driver-behaviour RNG.")
    args = ap.parse_args()

    if not NET.exists():
        sys.exit(f"Missing {NET}. Run build_net.py first.")
    if not RANDOM_TRIPS.exists():
        sys.exit(f"Missing randomTrips.py at {RANDOM_TRIPS}")

    produced = [generate(m, c, args.end, args.seed + i, args.tag)
                for i, (m, c) in enumerate(MODES.items())]
    print("\n[ok] route files:")
    for p in produced:
        print("   ", p)


if __name__ == "__main__":
    main()
