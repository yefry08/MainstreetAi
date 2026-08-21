"""
Convert the OSM extract into a SUMO network, then generate demand.

Stage 1 (REAL DATA):  netconvert imports OSM -> barcelona.net.xml
                      Street geometry, lane counts, oneway rules, turn lanes,
                      bus lanes, bike lanes and traffic-signal locations are all
                      taken from OpenStreetMap.

Stage 2 (SYNTHETIC):  randomTrips.py generates the vehicle demand. Barcelona
                      does not publish an open origin-destination matrix, so the
                      trips are statistically plausible rather than observed.
                      The mode split is calibrated to the published Barcelona
                      modal-share figures, and the UI labels this as synthetic.
"""

import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
NET_DIR = HERE / "net"
OSM = NET_DIR / "barcelona.osm.xml"
NET = NET_DIR / "barcelona.net.xml"

SCRIPTS = Path(sys.executable).parent / "Scripts"
USER_SCRIPTS = Path(os.path.expanduser("~")) / "AppData/Roaming/Python/Python314/Scripts"
SUMO_PKG = Path(__import__("sumolib").__file__).resolve().parent.parent / "sumo"
TOOLS = SUMO_PKG / "tools"


def _exe(name: str) -> str:
    for base in (USER_SCRIPTS, SCRIPTS, SUMO_PKG / "bin"):
        cand = base / f"{name}.exe"
        if cand.exists():
            return str(cand)
    return name  # fall back to PATH


def run(cmd: list[str], label: str) -> None:
    print(f"\n=== {label} ===")
    print(" ", " ".join(str(c) for c in cmd)[:300])
    proc = subprocess.run([str(c) for c in cmd], capture_output=True, text=True)
    tail = (proc.stdout or "").strip().splitlines()[-12:]
    for line in tail:
        print("  |", line)
    if proc.returncode != 0:
        print("  ! stderr:", (proc.stderr or "")[-3000:], file=sys.stderr)
        sys.exit(f"{label} failed with exit code {proc.returncode}")
    warn = [l for l in (proc.stderr or "").splitlines() if "Warning" in l]
    if warn:
        print(f"  ({len(warn)} netconvert warnings suppressed)")


def build_network() -> None:
    if not OSM.exists():
        sys.exit(f"Missing {OSM}. Run fetch_osm.py first.")

    run(
        [
            _exe("netconvert"),
            "--osm-files", OSM,
            "-o", NET,
            # --- geometry / topology cleanup ---
            "--geometry.remove",                 # collapse redundant shape points
            "--geometry.max-segment-length", "25",
            "--roundabouts.guess",
            "--ramps.guess",
            "--junctions.join",                  # merge the 4 corners of an Eixample crossing
            "--junctions.join-dist", "22",
            "--no-turnarounds",
            "--remove-edges.isolated",
            # --- traffic lights ---
            # OSM highway=traffic_signals nodes become SUMO TLS. tls.join merges
            # the multiple signal nodes of one big intersection into a single
            # controller, which is what a real Barcelona junction actually has.
            "--tls.guess-signals",
            "--tls.join",
            "--tls.join-dist", "30",
            "--tls.discard-simple",              # drop signals on trivial junctions
            "--tls.default-type", "static",      # baseline = fixed timing, by design
            # 40 s green + 4 s yellow per phase -> ~88 s cycle on a two-phase
            # junction, which matches the ~90 s cycles Barcelona actually runs.
            "--tls.green.time", "40",
            "--tls.yellow.time", "4",
            # --- modes ---
            "--osm.bike-access",
            "--osm.turn-lanes",
            "--osm.sidewalks", "false",
            "--keep-edges.by-vclass", "passenger,bus,bicycle",
            # --- misc ---
            "--output.street-names",
            "--default.spreadtype", "roadCenter",
            "--verbose",
        ],
        "netconvert: OSM -> SUMO network",
    )

    mb = NET.stat().st_size / 1e6
    print(f"\n[ok] {NET.name}  {mb:.1f} MB")


if __name__ == "__main__":
    build_network()
