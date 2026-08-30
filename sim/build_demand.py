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
import re
import subprocess
import sys
from pathlib import Path

import sumolib

HERE = Path(__file__).resolve().parent
NET_DIR = HERE / "net"
NET = NET_DIR / "barcelona.net.xml"

# Per-district demand. Barcelona's table below is the validated one; anything
# here overrides it for another district.
#
# SHIBUYA IS NOT BARCELONA, AND THE SPLIT SAYS SO
# Barcelona's defining feature is that roughly a third of its vehicle fleet is
# two-wheeled. Central Tokyo is the opposite: scooters are a small share, light
# commercial vehicles are a large one, and bicycles are common. Copying
# Barcelona's split across would have produced a Tokyo full of mopeds, which is
# a picture of Barcelona with Japanese street names on it.
#
# These proportions are an informed estimate of central-Tokyo road composition,
# not a figure lifted from a published Tokyo modal-share table. They are stated
# here so the assumption is visible rather than buried in a period constant.
#
# Volume is set so Shibuya carries the same vehicles-per-lane-km as Barcelona.
# A first pass scaled trips/hour by lane-km, which sounds equivalent and is not:
# Shibuya's trips are much shorter, so each one occupies the network briefly and
# concurrency came out at 0.24 veh/lane-km against Barcelona's 0.60 -- a
# district that looked half-abandoned. What matters on screen is how many
# vehicles are present at once, not how many are dispatched per hour, and those
# two only track each other when trip length is held constant.
#
# ~4,500 trips/h lands near Barcelona's density. It is deliberately short of
# saturation: past that point both twins jam at the same speed and the
# comparison the demo exists to show disappears.
#
# Trip lengths scale too: a 350 m minimum is a short hop across the Eixample
# and most of the way across a 2.2 km Shibuya extract.
DISTRICT_MODES = {
    # MIDTOWN MANHATTAN
    # Almost no two-wheelers: motorcycles are a rounding error in Manhattan
    # traffic, where Barcelona's are a third of the fleet. What Manhattan has
    # instead is freight -- it is one of the most delivery-dense districts
    # anywhere -- and, since the protected-lane build-out, a real cycling share.
    # Yellow cabs and rideshare all count as cars.
    #
    # TRIP LENGTH IS THE POINT HERE, not just a capacity lever. Manhattan is on
    # this list because avenue-length green waves are the textbook case for
    # signal coordination, and a controller cannot demonstrate coordination on
    # traffic that turns off after two blocks. Cars get a 350 m floor rather
    # than Shibuya's 140 so trips actually run the avenues.
    #
    # Longer trips occupy the network for longer, so the same density needs
    # FEWER of them: ~4,400 trips/h here against Shibuya's 4,500 on half the
    # lane-kilometres. Rate and concurrency only track each other when trip
    # length is held constant -- the mistake made once already on Shibuya.
    "manhattan": {
        #  name    vclass          vType    period  fringe  min_dist  share
        "car":   dict(vclass="passenger",  vtype="car",   period=1.28, fringe=2.6, min_dist=350),  # ~64%
        "bike":  dict(vclass="bicycle",    vtype="bike",  period=5.84, fringe=1.8, min_dist=200),  # ~14%
        "truck": dict(vclass="delivery",   vtype="truck", period=6.29, fringe=2.2, min_dist=300),  # ~13%
        "bus":   dict(vclass="bus",        vtype="bus",   period=13.6, fringe=1.2, min_dist=900),  # ~6%
        "moto":  dict(vclass="motorcycle", vtype="moto",  period=27.3, fringe=2.0, min_dist=250),  # ~3%
    },
    "shibuya": {
        #  name    vclass          vType    period  fringe  min_dist  share
        "car":   dict(vclass="passenger",  vtype="car",   period=1.22, fringe=2.2, min_dist=140),  # ~66%
        "bike":  dict(vclass="bicycle",    vtype="bike",  period=5.72, fringe=1.8, min_dist=110),  # ~14%
        "truck": dict(vclass="delivery",   vtype="truck", period=8.00, fringe=2.0, min_dist=180),  # ~10%
        "moto":  dict(vclass="motorcycle", vtype="moto",  period=13.3, fringe=2.0, min_dist=130),  # ~6%
        "bus":   dict(vclass="bus",        vtype="bus",   period=20.0, fringe=1.2, min_dist=700),  # ~4%
    },
}

# Fewer distinct O-D pairs on a smaller network: 1,600 car routes over 1,938
# edges would revisit the same streets so often the variety buys nothing.
DISTRICT_FLOW_COUNT = {
    "manhattan": {"car": 700, "moto": 90, "bike": 260, "truck": 260, "bus": 120},
    "shibuya": {"car": 500, "moto": 120, "bike": 200, "truck": 160, "bus": 90},
}
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
# TRIP LENGTH IS A CAPACITY LEVER, not just a realism setting.
#
# The first version used min_dist 600 m with fringe-factor 8, which biases both
# ends of a trip toward the edge of the extract — i.e. long cross-city runs.
# Every such vehicle occupies the network for many minutes, so concurrency
# climbed until the Eixample gridlocked: 6,602 vehicles, 80% stationary,
# 4.4 km/h, and BOTH twins collapsed to the same speed. Past saturation the
# adaptive controller has nothing left to recover, which destroys the very
# comparison the demo exists to show.
#
# Shorter, more local trips clear faster, so the same visual density costs far
# less network occupancy — which is what leaves headroom for the AI twin to
# pull away from the fixed-time twin instead of both jamming.
#
# Buses keep long routes and a low fringe factor on purpose: a bus route that
# crosses the city is what a bus route IS, and their journey time is the metric
# transit priority is judged on.
MODES = {
    #  name     vclass          vType    period  fringe  min_dist   share
    "car":   dict(vclass="passenger",  vtype="car",   period=0.80, fringe=2.5, min_dist=350),   # ~50%
    "moto":  dict(vclass="motorcycle", vtype="moto",  period=1.45, fringe=2.2, min_dist=300),   # ~28%
    "bike":  dict(vclass="bicycle",    vtype="bike",  period=3.30, fringe=1.8, min_dist=250),   # ~12%
    "truck": dict(vclass="delivery",   vtype="truck", period=6.70, fringe=2.2, min_dist=500),   # ~6%
    "bus":   dict(vclass="bus",        vtype="bus",   period=10.0, fringe=1.2, min_dist=1500),  # ~4%
}


def strip_vtypes(routes: Path) -> int:
    """
    Remove vType/vTypeDistribution definitions from a routed file, so that
    vtypes.add.xml can be the single source of truth.

    Writing FLOWS, duarouter keeps `type="car"` on each flow but never emits the
    <vTypeDistribution> that gives "car" a meaning, so SUMO refuses to start:

        The vehicle type 'car' for flow 'car0#0' is not known.

    Rebuilding the wrapper and splicing it back in seemed like the obvious fix
    and is not possible: duarouter writes each vType LAZILY, the first time a
    flow needs it, so type definitions are interleaved throughout the file.
    `car_electric` appears after 4,000 flows. There is no offset that is after
    every type and before every flow, and a distribution placed before one of
    its members fails with "Unknown vtype ... in distribution".

    So the types are stripped here and loaded from vtypes.add.xml with `-a`
    instead — which is the canonical SUMO arrangement anyway, and means the
    fleet definition lives in exactly one file rather than being duplicated
    into five generated ones.
    """
    text = routes.read_text(encoding="utf-8")
    before = len(text)
    # Both spellings: self-closing, and with <param> children.
    text = re.sub(r'[ \t]*<vType\b[^>]*/>\s*\n', '', text)
    text = re.sub(r'[ \t]*<vType\b.*?</vType>\s*\n', '', text, flags=re.S)
    text = re.sub(r'[ \t]*<vTypeDistribution\b[^>]*/>\s*\n', '', text)
    text = re.sub(r'[ \t]*<vTypeDistribution\b.*?</vTypeDistribution>\s*\n', '',
                  text, flags=re.S)
    routes.write_text(text, encoding="utf-8")
    return before - len(text)


def normalise_flow_rate(routes: Path, period: float) -> tuple[int, float]:
    """
    Force the flows in `routes` to collectively emit one vehicle per `period`.

    randomTrips' own `--flows` accounting cannot be trusted here. Asking for
    1,600 car flows produced 4,455, each carrying probability="0.42" — a 42%
    chance of emitting a vehicle every second, per flow. Collectively that is
    ~1,870 vehicles per second, and the simulation inserted 16,331 vehicles in
    the first 18 simulated seconds before this was caught.

    The fix is arithmetic rather than trust: the intended network-wide rate is
    1/period, so each of N flows gets probability (1/period)/N.
    """
    text = routes.read_text(encoding="utf-8")
    n = text.count("<flow ")
    if not n:
        return 0, 0.0
    per_flow = (1.0 / period) / n
    text = re.sub(r'probability="[\d.eE+-]+"', f'probability="{per_flow:.10f}"', text)
    routes.write_text(text, encoding="utf-8")
    return n, per_flow


def _unused_repair_type_distribution(routes: Path, vtype: str) -> bool:
    """Superseded by strip_vtypes; kept only to document why it cannot work."""
    text = routes.read_text(encoding="utf-8")
    if f'<vTypeDistribution id="{vtype}"' in text:
        return False
    if f'type="{vtype}"' not in text:
        return False  # flows already reference a concrete type

    # Membership comes from vtypes.add.xml, which is authoritative. An earlier
    # version guessed it by id prefix and silently dropped `van_diesel` from the
    # "truck" distribution — 72% of the freight fleet, gone, with no error. Ids
    # do not have to start with their distribution's name and several here
    # deliberately don't.
    source = (HERE / "vtypes.add.xml").read_text(encoding="utf-8")
    block = re.search(
        rf'<vTypeDistribution id="{re.escape(vtype)}".*?</vTypeDistribution>',
        source, re.S,
    )
    if not block:
        return False
    wanted = re.findall(r'<vType id="([^"]+)"', block.group(0))

    found = dict(re.findall(r'<vType id="([^"]+)"[^>]*?probability="([\d.]+)"', text))
    members = [(i, found[i]) for i in wanted if i in found]
    if len(members) != len(wanted):
        missing = [i for i in wanted if i not in found]
        print(f"  !! {vtype}: {missing} missing from the routed output")
    if not members:
        return False

    ids = " ".join(i for i, _ in members)
    probs = " ".join(p for _, p in members)
    element = (
        f'    <vTypeDistribution id="{vtype}" vTypes="{ids}" '
        f'probabilities="{probs}"/>\n'
    )

    # Anchor on the first <flow>, not on the last </vType>.
    #
    # SUMO resolves a distribution's members at parse time, so the element must
    # come after every vType it names. Anchoring on the last closing vType tag
    # looked right and was not: some of these types are self-closing and some
    # carry <param> children, so the search landed after the FIRST type and
    # SUMO rejected the file with "Unknown vtype 'car_petrol_eu6' in
    # distribution 'car'". duarouter always writes every type before the first
    # flow, so that boundary is the reliable one.
    anchor = text.find("<flow ")
    if anchor < 0:
        anchor = text.find("<vehicle ")
    if anchor < 0:
        return False
    line_start = text.rfind("\n", 0, anchor) + 1
    routes.write_text(text[:line_start] + element + text[line_start:], encoding="utf-8")
    print(f"  .. restored <vTypeDistribution id=\"{vtype}\"> "
          f"({len(members)} members)")
    return True


def generate(mode: str, cfg: dict, end: int, seed: int, tag: str = "",
             flows: int = 0) -> Path:
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

    # FLOWS, not individual trips.
    #
    # A trip file lists one departure per vehicle, so it covers exactly the
    # window it was generated for and then stops. Generating individual trips
    # for a whole day would mean routing ~100,000 vehicles and an 80 MB file
    # per mode; generating for one hour meant the network quietly DRAINED after
    # one simulated hour and the city went empty mid-demo, which is exactly the
    # failure this replaces.
    #
    # A flow emits vehicles at a rate over a period, so a few hundred flow
    # definitions produce continuous traffic for 24 simulated hours out of a
    # file measured in kilobytes. SUMO's setScale then modulates the insertion
    # rate hour by hour against the measured demand curve.
    if flows:
        cmd += ["--flows", str(flows), "--binomial", "3"]

    print(f"\n=== demand: {mode} (period={cfg['period']}s, vclass={cfg['vclass']}) ===")
    env = dict(os.environ)
    env["SUMO_HOME"] = str(TOOLS.parent)
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
    for line in (proc.stdout or "").strip().splitlines()[-6:]:
        print("  |", line)
    if proc.returncode != 0:
        print("  ! stderr:", (proc.stderr or "")[-2500:], file=sys.stderr)
        sys.exit(f"randomTrips failed for {mode}")

    strip_vtypes(routes)
    n_flow, per_flow = normalise_flow_rate(routes, cfg["period"])

    text = routes.read_text(encoding="utf-8")
    n_veh = text.count("<vehicle ")
    if n_flow:
        rate = 3600.0 / cfg["period"]
        print(f"  -> {routes.name}: {n_flow} flows, {rate:.0f} veh/h at peak "
              f"({routes.stat().st_size / 1e6:.1f} MB)")
    else:
        print(f"  -> {routes.name}: {n_veh} trips "
              f"({routes.stat().st_size / 1e6:.1f} MB)")
    return routes


def main() -> None:
    global NET
    ap = argparse.ArgumentParser()
    ap.add_argument("--district", default="barcelona")
    # A full simulated day. The demo needs to be able to sit on any hour of any
    # weekday without the network running dry.
    ap.add_argument("--end", type=int, default=86400,
                    help="seconds of demand to generate (default: 24 h)")
    ap.add_argument("--flows", type=int, default=1,
                    help="1 = continuous flows (default), 0 = one-off trips")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--tag", default="",
                    help="suffix for an alternate demand set, e.g. --tag _b "
                         "produces car_b.rou.xml. Used by validate_seeds.py to "
                         "test against genuinely different traffic rather than "
                         "just a different driver-behaviour RNG.")
    args = ap.parse_args()

    # Barcelona keeps the bare filenames it has always had, because the server
    # and every recorded run reference them by those exact names.
    if args.district != "barcelona":
        NET = NET_DIR / f"{args.district}.net.xml"
        if not args.tag:
            args.tag = f"_{args.district}"

    modes = DISTRICT_MODES.get(args.district, MODES)

    if not NET.exists():
        sys.exit(f"Missing {NET}. Run: python build_net.py --district {args.district}")
    if not RANDOM_TRIPS.exists():
        sys.exit(f"Missing randomTrips.py at {RANDOM_TRIPS}")

    # Distinct origin-destination pairs per mode. Enough that traffic does not
    # visibly repeat, few enough that the file stays small.
    FLOW_COUNT = DISTRICT_FLOW_COUNT.get(
        args.district,
        {"car": 1600, "moto": 900, "bike": 450, "truck": 300, "bus": 240})

    produced = [
        generate(m, c, args.end, args.seed + i, args.tag,
                 flows=FLOW_COUNT.get(m, 400) if args.flows else 0)
        for i, (m, c) in enumerate(modes.items())
    ]
    print("\n[ok] route files:")
    for p in produced:
        print("   ", p)


if __name__ == "__main__":
    main()
