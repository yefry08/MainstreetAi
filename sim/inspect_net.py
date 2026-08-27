"""Print a summary of the converted SUMO network (sanity check + demo talking points)."""

from collections import Counter
from pathlib import Path

import sumolib

import argparse as _argparse

_NET_DIR = Path(__file__).resolve().parent / "net"
_ap = _argparse.ArgumentParser()
_ap.add_argument("--district", default="barcelona")
NET = _NET_DIR / f"{_ap.parse_known_args()[0].district}.net.xml"


def main() -> None:
    print(f"loading {NET.name} ...")
    net = sumolib.net.readNet(str(NET), withPrograms=True)

    edges = net.getEdges()
    nodes = net.getNodes()
    tls = net.getTrafficLights()

    total_km = sum(e.getLength() * e.getLaneNumber() for e in edges) / 1000.0
    types = Counter((e.getType() or "?").replace("highway.", "") for e in edges)

    print("\n================ BARCELONA SUMO NETWORK ================")
    print(f"  edges (directed)     : {len(edges):,}")
    print(f"  junctions            : {len(nodes):,}")
    print(f"  traffic-light systems: {len(tls):,}")
    print(f"  lane-kilometres      : {total_km:,.0f} km")

    print("\n  road classes:")
    for t, n in types.most_common(12):
        print(f"    {t:<22} {n:>6,}")

    # how many phases does a typical junction have?
    phase_counts = Counter()
    for t in tls:
        progs = t.getPrograms()
        if progs:
            prog = next(iter(progs.values()))
            phase_counts[len(prog.getPhases())] += 1
    print("\n  signal programs by phase count:")
    for k in sorted(phase_counts):
        print(f"    {k} phases           {phase_counts[k]:>6,}")

    # geographic extent, in real coordinates
    x0, y0, x1, y1 = net.getBBoxXY()[0] + net.getBBoxXY()[1]
    lon0, lat0 = net.convertXY2LonLat(x0, y0)
    lon1, lat1 = net.convertXY2LonLat(x1, y1)
    print(f"\n  bbox lon/lat         : {lon0:.4f},{lat0:.4f} -> {lon1:.4f},{lat1:.4f}")
    print(f"  centre               : {(lon0 + lon1) / 2:.5f}, {(lat0 + lat1) / 2:.5f}")
    print("=======================================================")


if __name__ == "__main__":
    main()
