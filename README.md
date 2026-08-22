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
| Vehicle-hours lost at a standstill | 475.2 | 263.6 | **−44.5 %** |
| Vehicles queued at the final tick | 1 960 | 1 002 | **−48.9 %** |
| Average trip time | 789 s | 671 s | **−14.9 %** |
| Mean network speed | 10.8 km/h | 16.9 km/h | **+56.4 %** |
| Bus hours lost at a standstill | 29.3 | 11.1 | **−62.3 %** |
| Mean bus speed | 12.4 km/h | 22.8 km/h | **+83.0 %** |
| Trips completed in the window | 1 527 | 2 199 | **+44.0 %** |
| CO₂ | 6 636 kg | 5 922 kg | **−10.8 %** |
| NOₓ | 24.62 kg | 20.87 kg | **−15.2 %** |
| Fuel | 2 830 l | 2 525 l | **−10.8 %** |
| Teleports (SUMO's gridlock escape hatch) | 1 615 | 845 | **−47.7 %** |

The emissions figures cross-check: 6 636 kg CO₂ at 2.31 kg per litre of petrol
implies 2 873 l, against the 2 830 l SUMO reports independently — 1.5 % apart.

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

`python server/validate_seeds.py 1200 4` re-runs the entire paired experiment
four times, varying **both** SUMO's driver-behaviour seed **and** the underlying
trip demand (two independently generated demand sets). It reports the *worst*
case across runs, not the mean:

| metric | mean Δ | best | worst | |
|---|---:|---:|---:|---|
| Vehicle-hours lost stopped | −44.2 % | −45.0 % | −43.1 % | every run |
| Average trip time | −6.2 % | −7.4 % | −4.7 % | every run |
| Network speed | +3.2 % | +4.9 % | +0.6 % | every run |
| Bus hours lost stopped | −64.3 % | −66.0 % | −62.9 % | every run |
| Bus mean speed | +40.1 % | +52.3 % | +23.0 % | every run |
| Trips completed | +71.8 % | +72.7 % | +71.1 % | every run |
| CO₂ | −2.9 % | −3.6 % | −2.5 % | every run |
| NOₓ | −6.2 % | −6.9 % | −5.6 % | every run |
| Teleports | −46.1 % | −50.4 % | −42.1 % | every run |

### Equity: is the average bought at someone's expense?

The standard objection to adaptive signal control is that it improves the mean
by abandoning somebody on a side street. So the same sweep measures the *tail*
of the waiting-time distribution, not just the average:

| metric | mean Δ | worst | |
|---|---:|---:|---|
| p95 vehicle wait | −25.3 % | −21.3 % | every run |
| Worst wait in the network | −4.4 % | −3.3 % | every run |
| Vehicles waiting > 5 min | −68.6 % | −66.6 % | every run |

The tail improves too. The fairness cap in rule 4 is doing its job: the policy
is not trading side streets for arterials, it is removing standstill time from
both. In a single 600 s run the effect on the worst-off is stark — vehicles that
had been waiting more than five minutes fell from 91 to 4.

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

**Wanted but not available:**
- TMB does not publish an open GTFS feed on the municipal portal, so bus routes
  are not real line geometries.
- Bicing station locations *are* published but sit behind a free portal token
  (`sim/fetch_bcn_opendata.py` will fetch them if you set
  `BCN_OPENDATA_TOKEN`). Without a token the layer is simply absent — we do not
  substitute invented stations.

No data source is claimed that is not actually used. Nothing is fabricated.

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
python sim/fetch_bcn_opendata.py # Open Data BCN cycle network      (real)
```

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
python sim/build_demand.py --end 3600 --seed 909 --tag _b   # second demand set
python server/validate_seeds.py 1200 4
```

This re-runs the whole paired experiment while varying both SUMO's
driver-behaviour seed and the underlying trips, then reports the **worst** case
across runs rather than the mean — which is the number worth defending.

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
  src/scene/three/signals.js    1,151 signal masts with live state
  src/ui/Bezel.jsx          instrument readouts + bearing tape
  src/data/useSimSocket.js  binary frame decoder
```

### The front end

A dark control-room view of the city: real extruded OSM buildings, GPU-instanced
3D vehicles, and 1,151 traffic signals with live red/amber/green state, all over
a free camera (drag pan, scroll zoom, right-drag orbit, pitch to 85°).

The whole dynamic scene costs **7 draw calls** — 4 for the fleet, 3 for the
signals — regardless of how many vehicles are on screen.

Vehicles are **dead-reckoned** between simulation ticks. The wire format carries
no vehicle IDs, so vehicles cannot be matched frame-to-frame and therefore
cannot be interpolated; instead each one advances along its reported heading at
its reported speed until the next tick corrects it. Data arrives at ~5 Hz and
the scene renders at display rate, so traffic flows continuously rather than
stepping.

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
float32  n_veh * 5        lon, lat, angle, kind, speed  (focused twin only)
uint8    n_sig            0=red 1=yellow 2=green
uint8    n_edge           mean speed / speed limit, * 255
```

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
