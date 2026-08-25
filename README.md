# MainstreetAi

**AI traffic-signal orchestration for Barcelona, in a navigable 3D city.**

A live digital twin of central Barcelona in which an AI signal-control layer
runs **side by side** with today's fixed-time signals, on identical traffic, so
the difference is visible as it happens rather than asserted in a slide.

Built for the AI x City Climate Action Hackathon 2026, transportation track.

---

## What it does

Two full SUMO microsimulations of the same 9.6 × 7.2 km of Barcelona run at
once, from the same network, the same trips and the same random seed. The only
difference between them is who controls the traffic lights:

| | Twin A | Twin B |
|---|---|---|
| Signals | Fixed ~88 s cycle imported from OSM | AI adaptive controller |
| Sensing | none | per-approach queues, approaching buses, time of day |
| Represents | Barcelona today | Barcelona with the pilot deployed |

Because the demand is byte-identical, every percentage point of difference is
attributable to the control policy and nothing else.

## Measured result

Both twins run to t = 1800 s — half an hour of simulated morning peak, from
07:00 (`python server/compare.py 1800`):

| metric | fixed-time | AI-adaptive | change |
|---|---:|---:|---:|
| Vehicle-hours lost at a standstill | 154.3 | 75.6 | **−51.0 %** |
| Vehicles at a standstill, final tick | 658 | 271 | **−58.8 %** |
| Average trip time | 751 s | 629 s | **−16.3 %** |
| Network speed | 15.6 km/h | 21.6 km/h | **+38.2 %** |
| Bus hours lost at a standstill | 4.93 | 1.58 | **−68.0 %** |
| Bus speed | 15.9 km/h | 26.9 km/h | **+69.6 %** |
| Trips completed in the window | 615 | 860 | **+39.8 %** |
| CO₂ | 2 384 kg | 2 211 kg | **−7.3 %** |
| NOₓ | 7.35 kg | 6.39 kg | **−13.0 %** |
| Fuel | 1 016 l | 942 l | **−7.3 %** |
| Teleports (SUMO's gridlock escape hatch) | 895 | 494 | **−44.8 %** |

Both speed rows are **time-integrated** — total distance covered divided by
total vehicle-seconds in the network — not SUMO's instantaneous mean sampled
at the final tick. On this very run the instantaneous figure put bus speed at
+131.9 %; the integrated one says +69.6 %, and four seed-varied runs agree
with the integrated one. The volatile number is the flattering number, which
is exactly why it is not the one quoted.

The emissions figures cross-check: 2 384 kg CO₂ at 2.31 kg per litre of petrol
implies 1 032 l, against the 1 016 l SUMO reports independently — 1.6 % apart.

### Read the emissions number late, not early

CO₂ is the one metric that needs the run to mature before it means anything:

| at t = | CO₂ change | why |
|---|---:|---|
| 600 s | **+10.0 %** | the AI twin has completed 141 trips to the baseline's 63 — it burned more fuel because it did more than twice the work |
| 1200 s | −3.1 % | throughput evens out as the baseline finally clears its queues |
| 1800 s | **−10.8 %** | congestion compounds in the baseline; the gap keeps widening |

This is not a bug and it is worth understanding before anyone puts it on a
slide. Early in a run, total emissions partly measure *how much traffic actually
moved*, and the AI moves more of it sooner. Only once both twins have cleared a
comparable number of trips does the figure become a like-for-like comparison.
Delay and transit metrics are meaningful from the first minute; emissions are
not.

Read all of this as *simulation outcomes on modelled demand*, not as
measurements from Barcelona's streets. See "Honesty" below.

### Does it hold up, or did we get a lucky seed?

`python server/validate_seeds.py 1800 4` re-runs the entire paired experiment
four times, varying **both** SUMO's driver-behaviour seed **and** the underlying
trip demand (two independently generated demand sets — seeds 42/1337 on set A,
42/2026 on set B). It reports the *worst* case across runs, not the mean:

| metric | mean Δ | best | worst | |
|---|---:|---:|---:|---|
| Vehicle-hours lost stopped | −52.6 % | −54.7 % | −51.0 % | every run |
| Average trip time | −16.4 % | −17.8 % | −15.1 % | every run |
| Network speed | +39.3 % | +41.7 % | +38.2 % | every run |
| Bus hours lost stopped | −72.2 % | −77.1 % | −68.0 % | every run |
| Bus speed | +70.1 % | +78.7 % | +60.5 % | every run |
| Trips completed | +40.1 % | +40.4 % | +39.8 % | every run |
| CO₂ | −7.9 % | −8.9 % | −7.2 % | every run |
| NOₓ | −13.9 % | −15.0 % | −13.0 % | every run |
| Teleports | −40.7 % | −44.8 % | −36.7 % | every run |

The network-speed row used to read +3.2 %. That was not a different result —
it was a different *instrument*. The old figure came from SUMO's instantaneous
mean speed, sampled at one arbitrary tick on each of two independently seeded
twins; consecutive samples of it swung between +98 % and −4 % while the
underlying advantage sat steady. The row above uses the time-integrated
network speed (total distance ÷ total vehicle-seconds), which is what the
metric was always meant to express.

### Equity: is the average bought at someone's expense?

The standard objection to adaptive signal control is that it improves the mean
by abandoning somebody on a side street. So the same sweep measures the *tail*
of the waiting-time distribution, not just the average:

| metric | mean Δ | best | worst | |
|---|---:|---:|---:|---|
| p95 vehicle wait | −40.2 % | −50.9 % | −33.8 % | every run |
| Vehicles waiting > 5 min | −76.0 % | −77.6 % | −72.1 % | every run |
| Worst wait in the network | −3.4 % | −11.3 % | **+0.3 %** | **MIXED** |

The bulk of the tail improves substantially: the 95th percentile wait falls by
at least a third on every run, and the number of vehicles stuck for more than
five minutes falls by at least 72 %. The fairness cap in rule 4 is doing its
job — the policy is not trading side streets for arterials.

**The single worst-off vehicle is the honest exception.** Across four runs it
improved three times and got 0.3 % worse once, so the correct claim is that
adaptive control does *not reliably* help the very worst case, only the shape
of the distribution behind it. That row is left in the table rather than
dropped: a metric that refuses to confirm the thesis is the most useful one on
the page, and an earlier version of this README reported it as "every run" on
the strength of a smaller sweep that happened not to contain a counterexample.

### By corridor

The named corridors, as flow index (vehicle-weighted speed ÷ speed limit,
1.0 = free flow), from a 600 s run:

| corridor | fixed-time | AI-adaptive | change |
|---|---:|---:|---:|
| Avinguda Diagonal | 0.366 | 0.427 | **+16.7 %** |
| Gran Via de les Corts | 0.548 | 0.819 | **+49.5 %** |
| Avinguda Meridiana | 0.794 | 0.965 | **+21.5 %** |

Gran Via gains most because it starts most congested — which is the general
shape of the result: the policy helps most exactly where there is most to fix.
This is also the table a pilot proposal would be judged on, since a pilot
instruments one corridor rather than a city.

> Getting this measurement right required raising SUMO's `--waiting-time-memory`
> from its 100 s default. At the default, accumulated waiting time saturates at
> 100 s, both twins peg to the same value, and the equity metrics read as an
> exact 0.0 % difference — which looks like "no effect" but is really "the
> instrument is maxed out." Worth knowing if you build something similar.

---

## The AI policy

Deliberately rules-based and auditable, not reinforcement learning. Every
decision is explainable in one sentence, which is the bar a city transport
authority would actually set before letting software touch live signal hardware.

At each control tick, for every junction currently showing green:

```
served   = vehicles queued on approaches that have green now
waiting  = vehicles queued on approaches held at red
bus_here = a bus within 140 m on a green approach
bus_wait = a bus within 140 m on a red approach
```

then, in strict priority order:

1. **HOLD** if the green is younger than `min_green` (8 s) — safety, inviolable
2. **RELEASE** if a bus waits at red and none is being served — transit priority
3. **HOLD** if a bus is being served and green < `tsp_max` (70 s) — transit priority
4. **RELEASE** if green has reached `max_green` — fairness cap, scaled by time of day
5. **HOLD** if `served ≥ waiting × 1.15` — throughput
6. **RELEASE** otherwise

The controller never constructs a phase. It only chooses to hold or release,
and SUMO always runs its own yellow/all-red clearance, so the policy is
structurally incapable of producing an unsafe signal state.

Time-of-day scaling comes from an hourly demand profile shaped to the Barcelona
working day (sharp 08:00 peak, broad midday plateau, longer 18:00–20:30 evening
peak).

---

## Honesty about the data

This matters more than the numbers, so it is also shown in the UI.

**Real:**
- Street network, lane counts, one-way rules, turn lanes, bus lanes and bike
  lanes — OpenStreetMap via the Overpass API (10.9 MB extract)
- 1 151 traffic-light locations and their phase structure — OSM, imported by
  `netconvert`
- The cycle-lane network — the Ajuntament de Barcelona's own published
  `carril-bici` dataset from Open Data BCN, 386 segments / ~209 km inside the
  extract, drawn on the map as-is
- **When the peaks are** — derived from **3,242,572 real observations** of
  Barcelona's own traffic-state feed (Open Data BCN `trams`, 532 road sections,
  Jan–Mar 2026). The morning peak is 08:00, the afternoon peak 17:00, the
  evening 18:00, and Friday is the busiest day, because that is what the city
  measured. See `sim/fetch_traffic_profile.py`.
- **Weather** — live from Open-Meteo (free, no key). Rain is not a graphic: it
  lowers speed factors, lengthens headways, weakens braking and takes cyclists
  off the road, through the same levers the manual rain scenario uses.
- Vehicle dynamics — SUMO microsimulation (Krauss car-following)
- Emissions — SUMO's HBEFA3 model, computed per vehicle from actual speed and
  acceleration traces, not a grams-per-km multiplier

**Modelled / synthetic:**
- Trip origins and destinations. Barcelona publishes no open O/D matrix, so
  trips are generated statistically by `randomTrips.py` with a fringe factor
  that reproduces a city-centre cordon's through-traffic pattern.
- Bus movements run on genuinely bus-permitted links but are **not** live TMB
  vehicle positions and are not tied to a GTFS timetable.
- Fleet composition is calibrated to the Barcelona metro-area mix but is not a
  vehicle-by-vehicle registry.

**Derived, and labelled as such:** the `trams` feed reports how congested a
section *is*, not how many vehicles are on it — an empty road at 03:00 still
reports "very fluid", so the measured index floors at ~0.45 of peak while real
volume is nearer 0.10. Feeding it in raw would put four times too much traffic
on the network overnight. So the **shape** of the demand curve is measured and
the **amplitude** is rescaled, with the transform stated in the profile JSON
itself (`derivation.formula`). Congestion state is not traffic volume, and
conflating them would be a fabrication wearing real data's clothes.

**The 3D city is smaller than the simulation.** Signals and traffic span about
8.0 × 6.4 km; the building extract covers 2.7 × 3.1 km — **17% of that
footprint**. Pull the camera back and the 3D city visibly stops while traffic
carries on over flat basemap. It is a deliberate trade for browser performance,
and it is adjustable with measured numbers rather than guesswork:

| extent | area | buildings | file | coverage |
|---|---|---|---:|---:|
| default | 2.7 × 3.1 km | 10,425 | 3.8 MB | 17% |
| `--expand 2` | 6.1 × 5.3 km | 29,991 | 11.1 MB | 63% |

```bash
python sim/fetch_buildings.py --expand 2
```

Judge it on the target machine, not the download — the file is served from
localhost, so its size costs nothing on the wire. What it costs is parse time
and GPU load for ~30k extruded polygons, and the stated target is an Intel
N100. The default stays because that cost has not been measured there.

**Wanted but not available:**
- TMB does not publish an open GTFS feed on the municipal portal, so bus routes
  are not real line geometries.
- Bicing station locations *are* published but sit behind a free portal token
  (`sim/fetch_bcn_opendata.py` will fetch them if you set
  `BCN_OPENDATA_TOKEN`). Without a token the layer is simply absent — we do not
  substitute invented stations.

**Live, on by default, no key:** Barcelona's *current* traffic state. The
Ajuntament republishes the congestion of all 532 instrumented sections every
few minutes, CC BY 4.0, no registration — the same `trams` feed the demand
profile was measured from, read live instead of historically. It appears in
the masthead as `BCN live · N% congested`, the one non-simulated figure on
screen, and on `/api/feeds/bcn`. See `server/feeds/bcn.py`.

Three things about that feed are traps, and all three are handled:

- **Only one of its ~100 resources is current.** The rest are monthly CSV
  archives; the newest is last month's. Pointing at one produces a convincing
  "live" panel showing traffic from weeks ago. CKAN's own metadata misleads
  here too — it reports the live file's `last_modified` as 2023, because the
  file is overwritten in place rather than replaced.
- **Timestamps are Barcelona local with no offset marker.** Parsed naively
  from another timezone they read hours in the future, which either looks like
  a clock bug or, worse, makes a staleness check accept old data.
- **State `0` means "detector down", not "clear".** Averaging it in as a low
  number reports broken sensors as free-flowing traffic. It is excluded from
  every aggregate, so the percentage is a share of what is actually measuring
  — which is why the denominator moves between polls.

**Optional live feeds (off by default):** two further external sources can be
plugged in — Barcelona traffic control data, and vehicle data — via
`server/feeds/`.
Both are inert until a key *and* a URL are supplied in `.env`, and there is
deliberately **no default endpoint in the source**: a plausible-looking URL
invented here would be a fabricated data source that appears to work. An
unconfigured feed reports `not_configured` and the UI keeps labelling that
data simulated. `/api/feeds` exposes the provenance without touching the
network, and without ever returning the credential.

Before any parsing is written against a feed, `python server/feeds/probe.py`
reports what the endpoint actually returns — shape, record counts, candidate
coordinate/time/state fields — so the integration is built against the real
payload rather than an assumption about it.

No data source is claimed that is not actually used. Nothing is fabricated.

---

## Demand amplitude

The measured profile says *when* Barcelona is busy. How much of that this
network can actually clear is a separate question, and getting it wrong
destroys the demo in one of two directions: too little traffic and both twins
flow, so there is nothing to see; too much and both gridlock, so there is
still nothing to see.

Calibration (`server/calibrate.py`, a **fresh simulation pair per point** —
gridlock is absorbing, so sweeping demand against one long-running server
measures nothing) puts the usable operating point at 0.79 of measured peak:

| vehicles | stopped | fixed-time | AI | gain | bus gain |
|---:|---:|---:|---:|---:|---:|
| 1,044 | 31% | 16.0 km/h | 22.3 km/h | +39% | +65% |
| 1,174 | 35% | 15.0 km/h | 20.9 km/h | +39% | +82% |
| 1,209 | 39% | 14.6 km/h | 20.4 km/h | +40% | +86% |

Dense enough to look congested, with the adaptive twin visibly clearing it.
Tune with `MAINSTREET_CAPACITY` — the measured *shape* is never altered, only
its amplitude.

---

## Network scale

| | |
|---|---|
| Area | 9.6 × 7.2 km, centred on the Eixample |
| Directed edges | 11 529 |
| Junctions | 6 268 |
| Traffic-light systems | 1 151 |
| Lane-kilometres | 1 343 |
| Corridors identified | Diagonal (184 edges), Gran Via (146), Meridiana (56) |
| Demand | 7 200 cars + 1 637 bikes + 515 buses per simulated hour |

---

## Running it

Requires Python 3.11+ and Node 18+. SUMO itself installs from PyPI — no separate
system install needed.

```bash
pip install eclipse-sumo libsumo sumolib traci pyproj numpy fastapi "uvicorn[standard]" requests
```

**One-time data build** (downloads ~11 MB from Overpass, then converts):

```bash
python sim/fetch_osm.py          # Overpass -> OSM extract          (real)
python sim/build_net.py          # netconvert -> SUMO network       (real)
python sim/build_demand.py       # randomTrips -> route files  (synthetic)
python sim/export_geo.py         # SUMO net -> GeoJSON for the map
python sim/build_signal_approaches.py   # per-approach signal lamps
python sim/fetch_bcn_opendata.py # Open Data BCN cycle network      (real)
```

Rerun `build_signal_approaches.py` whenever the network is rebuilt. Both ends
fall back to one lamp per junction if the file is missing, so a stale or absent
file does not crash anything — it just quietly gives you the worse display,
which is the harder failure to notice.

**Demo mode — one process, one port.** Build the web app once, then the Python
server serves it directly alongside the WebSocket:

```bash
npm --prefix web install && npm --prefix web run build
python server/app.py
```

Open **http://127.0.0.1:8000**. Nothing else needs to be running, which is what
you want on a conference projector.

**Dev mode — hot reload.** Run the Vite dev server against the same backend; it
proxies `/api` and `/ws` to port 8000:

```bash
python server/app.py          # terminal 1
npm --prefix web run dev      # terminal 2
```

Open http://localhost:5173.

Either way, allow ~60 s on first start: both twins load a 30 MB network before
the first frame. On Windows, `.\setup.ps1` and `.\run.ps1` wrap all of this.

**Headless A/B instead of the UI:**

```bash
python server/compare.py 1800
```

**Repeat the experiment across seeds and demand sets:**

```bash
python sim/build_demand.py --seed 909 --tag _b   # second demand set, 24 h
python server/validate_seeds.py 1800 4
```

This re-runs the whole paired experiment while varying both SUMO's
driver-behaviour seed and the underlying trips, then reports the **worst** case
across runs rather than the mean — which is the number worth defending.

**Rebuild `_b` whenever the demand pipeline changes.** A stale set fails at
`libsumo.start` with *"Another vehicle type (or distribution) with the id
'car_electric' exists"* — route files generated before vTypes moved into
`vtypes.add.xml` still declare their own. Those runs are dropped, and the
summary then reports "improved on every run" over however many survived, so
the footer prints the surviving run count and lists any failures. Check it: a
four-run verdict backed by two runs is a weaker claim than it looks.

---

## Architecture

```
sim/                      one-time data pipeline
  fetch_osm.py            Overpass -> barcelona.osm.xml        (real data)
  build_net.py            netconvert -> barcelona.net.xml      (real data)
  build_demand.py         randomTrips -> car/bike/bus routes   (synthetic)
  export_geo.py           SUMO net -> roads/signals GeoJSON
  fetch_bcn_opendata.py   Open Data BCN cycle network          (real data)
  inspect_net.py          network summary / sanity check
  vtypes.add.xml          HBEFA3 emission classes per vehicle type

server/
  controllers.py          FixedTimeController + AdaptiveController
  sim_worker.py           one SUMO instance per OS process, via libsumo
  app.py                  FastAPI, binary WebSocket, event injection
  compare.py              headless A/B harness
  validate_seeds.py       repeats the A/B across seeds and demand sets
  profile_step.py         per-phase timing of the simulation loop
  smoke_test.py           run one twin and print what it emits

server/feeds/         external data, with honest provenance
  bcn.py              Barcelona's live traffic state (real, keyless, on)
  live.py             fetch + TTL + stale/error states, never leaks a key
  probe.py            report what an endpoint returns before parsing it

server/ai/            the two AI roles — inert without keys
  config.py           separate keys per role, loaded from .env
  orchestrator.py     LLM sets signal POLICY; rules execute it
  emulator.py         natural language -> structured scenario events
  README.md           architecture, bounds, and how to plug keys in

web/
  src/scene/Scene.jsx       MapLibre basemap + camera + three.js layer
  src/scene/buildings.js    extruded OSM footprints, raised on load
  src/scene/three/geo.js    WGS84 <-> Mercator <-> scene metres (tested)
  src/scene/three/traffic.js    instanced 3D vehicles, dead-reckoned
  src/scene/three/signals.js    3,230 approach lamps with live state (tested)
  src/ui/Bezel.jsx          instrument readouts + bearing tape
  src/ui/LiveCity.jsx       real Barcelona congestion, live, in the masthead
  src/data/useSimSocket.js  binary frame decoder
```

**Tests** — no framework, no runner; each is a plain script that exits non-zero.

```bash
node web/src/scene/three/geo.test.mjs        # projection round-trips
node web/src/scene/three/ribbons.test.mjs    # triangle winding
node web/src/scene/three/signals.test.mjs    # signal repaint correctness
node web/src/scene/three/traffic.test.mjs    # per-vehicle heading
node web/src/design/tokens.test.mjs          # no undefined CSS variables
python server/test_feeds.py                  # feed states + BCN parser
```

Each exists because something failed silently once. The token test is the
clearest case: an undefined custom property does not error, and used as a
`background` it resolves to transparent — which is how the split meter's
fixed-time bar, half of the comparison the whole demo rests on, came to render
as nothing at all while panels.css carried a careful comment about which shade
of grey it should be.

### The front end

A dark control-room view of the city: real extruded OSM buildings, GPU-instanced
3D vehicles, and live red/amber/green signals over a free camera (drag pan,
scroll zoom, right-drag orbit, pitch to 85°).

The whole dynamic scene costs **9 draw calls** — 6 for the fleet, 3 for the
signals — regardless of how many vehicles are on screen.

**Signals are per APPROACH, not per junction.** Barcelona's 1,151 signalised
junctions carry 3,230 approach lamps, each coloured by the links arriving from
that approach. This matters more than it sounds: a junction-level lamp has to
answer "is anything green here", and the answer is almost always yes. Measured
on this network, 94% of samples at multi-approach junctions have approaches in
DIFFERENT states, and one junction cycles 17 distinct phases that all collapse
to a single green byte. Opposing approaches now visibly differ, which is the
only way a signal reads as a signal. See `sim/build_signal_approaches.py` —
regenerate it and the wire format together, since the server emits one state
byte per feature in that file's order.

Vehicles are **dead-reckoned** between simulation ticks. The wire format carries
no vehicle IDs, so vehicles cannot be matched frame-to-frame and therefore
cannot be interpolated; instead each one advances along its reported heading at
its reported speed until the next tick corrects it. Data arrives at ~5 Hz and
the scene renders at display rate, so traffic flows continuously rather than
stepping.

**Nothing may be remembered per instance slot**, and this is sharper than it
sounds. The array is repacked every tick: measured on the real network, a given
slot holds the same vehicle only **36.4%** of the time. An earlier attempt at
smooth cornering eased each vehicle from `yawTarget[i]` — the heading of
whatever last occupied that slot — and so rendered a rotation more than 15°
wrong on **55.2%** of slot-ticks, median error **95°**. It read as vehicles
gliding gracefully the wrong way round, which is worse than the snapping it
replaced, and no screenshot would have caught it.

The fix is to carry each vehicle's own **turn rate** as a sixth float on the
wire, so heading extrapolates forward from measured per-vehicle state exactly
as position extrapolates from speed. `traffic.test.mjs` pins it: a slot whose
occupant changes must render the new vehicle's heading, not a blend with the
old one's.

Buildings come from our own OSM extract (`sim/fetch_buildings.py`), not the
basemap. Only the OpenMapTiles schema carries per-building height and its one
free host is a single point of failure — on conference wifi that is exactly what
stops resolving, and the 3D city would silently flatten to nothing. Owning the
geometry also means the city stands up offline.

### The AI layer

Two roles, two keys, both **inert without a key** — the simulation falls back to
the validated rules-based policy and the three built-in scenarios.

The architectural point: **an LLM cannot drive 1,151 junctions at 1 Hz.** So the
orchestrator is a *strategic* layer that reads the whole network once a minute
and returns five bounded policy parameters, which the deterministic controller
executes every second at every junction. Every parameter is clamped in code —
the model cannot set a green below the pedestrian clearance interval, and it
cannot change the six rules at all.

See [`server/ai/README.md`](server/ai/README.md).

### Why two processes

`libsumo` links SUMO directly into the Python process, making the ~15 000
per-vehicle state reads per simulated second cost microseconds instead of
milliseconds. Its constraint is one simulation per process — which is exactly
why each twin gets its own. They are paced independently and the server pairs
their latest snapshots.

### Wire format

One binary frame per tick, rather than JSON:

```
uint32   headerLen        (header padded so the float block stays 4-byte aligned)
bytes    headerLen        UTF-8 JSON: metrics for BOTH twins, clock, events
float32  n_veh * 6        lon, lat, angle, kind, speed, turn  (focused twin)
uint8    n_sig            0=red 1=yellow 2=green, in signal_approaches.geojson order
uint8    n_edge           mean speed / speed limit, * 255
```

`n_sig` rides in the JSON header, so the approach split (1,151 -> 3,230 lamps)
cost no format change — just 2 KB more per frame.

~52 KB per frame at 2 300 vehicles. The browser builds typed-array views
directly onto the socket buffer with no copying and no per-object allocation.

---

## Scenario injection

Events are applied to **both** twins identically, so the comparison stays fair
under stress.

| Event | What it does |
|---|---|
| Camp Nou lets out | 900 extra car trips injected within 700 m of the stadium, spread over 10 simulated minutes |
| Metro L1 disruption | 650 displaced trips loaded onto the Meridiana road corridor |
| Rain starts | speed factor 0.78, headway 1.1 → 1.6 s, deceleration reduced, cyclists slow 28 % |
| Rain stops | restores dry-road behaviour |

Injected routes are computed with SUMO's free-flow router from the same seed in
both twins, so both receive byte-identical extra traffic.

---

## Known limitations

- **Teleports.** Under the peak demand modelled here the fixed-time twin
  gridlocks hard enough that SUMO teleports ~670 vehicles per 20 simulated
  minutes to break deadlock. The AI twin roughly halves that. Teleports are a
  reasonable *proxy* for gridlock severity but they do mean some vehicles skip
  ahead rather than sitting in the jam, which if anything **understates** the
  delay difference between the twins.
- No pedestrian modelling; pedestrian phases are implicit in the imported signal
  programs rather than simulated as crossing demand.
- Bike lanes are respected where OSM tags them, but there is no sublane model,
  so cyclist–car interaction inside a shared lane is approximated.
- The validation sweep covers a handful of seeds and two demand sets at one
  demand *level*. A deployable claim would need a sweep across demand levels
  too — off-peak, and an overloaded network where the AI has less room to help.
- Basemap tiles come from a public service; the demo needs network access for
  the map imagery, though the simulation itself is entirely local.
