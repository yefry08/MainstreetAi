# Graph Report - MainstreetAi  (2026-08-25)

## Corpus Check
- 69 files · ~60,499 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 528 nodes · 764 edges · 32 communities (26 shown, 6 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 32 edges (avg confidence: 0.84)
- Token cost: 24,000 input · 6,200 output

## Community Hubs (Navigation)
- AI Role Configuration
- Adaptive Signal Controller
- FastAPI Server Endpoints
- React UI And Socket
- External Feed Layer
- 3D Buildings And Basemap
- Instanced Vehicle Rendering
- Frontend Dependencies
- A/B Measurement Harnesses
- Barcelona Traffic Profile
- Geographic Projection
- Design Token Audit
- Measurement Integrity Doctrine
- Congestion Overlay Geometry
- Twin Orchestration Engine
- Open Data BCN Layers
- Synthetic Demand Generation
- OSM Building Fetch
- Camera Presets
- SUMO Network Build
- GeoJSON Export
- Bounded AI Control Rationale
- Dead Reckoning Wire Contract
- Per-Approach Signal Lamps
- OSM Street Fetch
- Network Sanity Check
- 3D Coverage Limits
- Provider Failure Tolerance
- Pedestrian Modelling Gap

## God Nodes (most connected - your core abstractions)
1. `AdaptiveController` - 15 edges
2. `run_worker()` - 15 edges
3. `RoleConfig` - 13 edges
4. `Engine` - 12 edges
5. `WeatherFeed` - 12 edges
6. `createTraffic()` - 12 edges
7. `createProjection()` - 11 edges
8. `Orchestrator` - 9 edges
9. `FeedConfig` - 9 edges
10. `_run()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `Congestion Is Not Volume` --semantically_similar_to--> `Emissions Warm-Up Artefact`  [INFERRED] [semantically similar]
  README.md → DEMO.md
- `Model Chooses, Simulation Decides` --semantically_similar_to--> `The Honest Claim`  [INFERRED] [semantically similar]
  server/ai/README.md → DEMO.md
- `Twin Clock Drift` --semantically_similar_to--> `Policy Reaches The AI Twin Only`  [INFERRED] [semantically similar]
  README.md → server/ai/README.md
- `No Default Endpoint` --semantically_similar_to--> `Bounded By Construction`  [INFERRED] [semantically similar]
  README.md → server/ai/README.md
- `Teleports Understate The Result` --rationale_for--> `Measured Result`  [INFERRED]
  DEMO.md → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Measurement Integrity Practices** — readme_integrated_speed, readme_clock_drift, demo_worst_case_reporting, demo_teleport_understates, demo_emissions_warm_up [INFERRED 0.85]
- **A/B Comparison Integrity** — demo_twin_experiment, server_ai_readme_policy_ai_twin_only, server_ai_readme_bounded_by_construction, readme_seed_validation [EXTRACTED 1.00]
- **Honest Provenance Stance** — demo_honest_claim, readme_congestion_not_volume, readme_no_default_endpoint, readme_live_bcn_feed, server_ai_readme_model_chooses_sim_decides [INFERRED 0.85]

## Communities (32 total, 6 thin omitted)

### Community 0 - "AI Role Configuration"
Cohesion: 0.06
Nodes (40): emulator_config(), infer_provider(), orchestrator_config(), Configuration for the two AI roles. Each role gets its OWN key and its OWN…, Safe to serve over the API — never includes the key., Surfaced on /api/health so the UI shows what is actually wired up., Identify the provider from the credential's prefix., Configured model first, then the rest of the provider's chain. (+32 more)

### Community 1 - "Adaptive Signal Controller"
Cohesion: 0.05
Nodes (36): ndarray, AdaptiveController, build_plans(), clock_string(), demand_curve(), demand_factor(), FixedTimeController, JunctionPlan (+28 more)

### Community 2 - "FastAPI Server Endpoints"
Cohesion: 0.07
Nodes (28): FastAPI, get, post, ai_policy(), ai_scenario(), bcn_traffic(), control(), event() (+20 more)

### Community 3 - "React UI And Socket"
Cohesion: 0.08
Nodes (23): App(), BASEMAP_LABEL, decodeFrame(), postControl(), useSimSocket(), Atmosphere(), Bezel(), CARDINALS (+15 more)

### Community 4 - "External Feed Layer"
Cohesion: 0.09
Nodes (24): _load_dotenv(), Minimal .env reader. Deliberately not python-dotenv: this reads a handful of…, Live data feeds. Two external sources sit behind this package: Feed A Barcelona…, feed_status(), FeedConfig, FeedResult, fetch(), Any (+16 more)

### Community 5 - "3D Buildings And Basemap"
Cohesion: 0.08
Nodes (26): addBuildings(), BASE_EXPR, COLOR_EXPR, growBuildings(), HEIGHT_EXPR, RAW_HEIGHT, ROOF_COLOR_EXPR, pruneUnusableSources() (+18 more)

### Community 6 - "Instanced Vehicle Rendering"
Cohesion: 0.11
Nodes (25): CAPACITY, COLOR, createTraffic(), anisotropic, close, frame(), ORIGIN, proj (+17 more)

### Community 7 - "Frontend Dependencies"
Cohesion: 0.07
Nodes (26): @fontsource/archivo, @fontsource/jetbrains-mono, maplibre-gl, react, react-dom, three, vite, @vitejs/plugin-react (+18 more)

### Community 8 - "A/B Measurement Harnesses"
Cohesion: 0.11
Nodes (21): _collect(), main(), Find the congestion level where the AI twin pulls away from fixed-time. The…, run_point(), collect(), main(), Headless A/B: run both twins to a fixed simulated time and print the delta.…, Reader thread: keep the newest snapshot until the sim passes `until`. (+13 more)

### Community 9 - "Barcelona Traffic Profile"
Cohesion: 0.11
Nodes (18): datetime, _madrid_offset(), parse_trams(), Live traffic state for Barcelona, from Open Data BCN. This is the real thing:…, Parse the live TRAMS_TRAMS.dat body into a state summary., The small, display-safe part of the above, for the provenance panel., UTC offset for Barcelona at a given local time. Used only when the IANA…, summary() (+10 more)

### Community 10 - "Geographic Projection"
Cohesion: 0.15
Nodes (18): createProjection(), toLngLat(), toScene(), EARTH_CIRCUMFERENCE, haversineMetres(), lngLatToMercator(), mercatorScaleDenominator(), mercatorToLngLat() (+10 more)

### Community 11 - "Design Token Audit"
Cohesion: 0.10
Nodes (17): bgMisses, contrast(), cssFiles, defined, failing, files, HERE, inkSevenAsText (+9 more)

### Community 12 - "Measurement Integrity Doctrine"
Cohesion: 0.12
Nodes (19): Emissions Warm-Up Artefact, Equity Block, The Honest Claim, Six-Month Corridor Pilot, Teleports Understate The Result, Twin Experiment, Worst-Case Reporting, Twin Clock Drift (+11 more)

### Community 13 - "Congestion Overlay Geometry"
Cohesion: 0.16
Nodes (14): CONGESTION_LEGEND, congestionRGBA(), STOPS, TIER_ALPHA, createNetwork(), buildRibbons(), ribbonMaterial(), setFeatureColor() (+6 more)

### Community 14 - "Twin Orchestration Engine"
Cohesion: 0.21
Nodes (6): Engine, Push live conditions into both twins whenever they change. Both twins,…, Strategic control loop. Deliberately slow. An LLM cannot drive 1,151 junctions…, mp.Queue.get blocks, so each worker gets a reader thread., Combine the latest snapshot from each twin into one wire frame., Owns the two worker processes and the latest snapshot from each.

### Community 15 - "Open Data BCN Layers"
Cohesion: 0.24
Nodes (9): RuntimeError, Path, clip_line(), fetch_bicing(), fetch_bike_lanes(), in_bbox(), Fetch REAL published City of Barcelona datasets to overlay on the simulation.…, Bicing sits behind a free Open Data BCN portal token (the download URL 302s to… (+1 more)

### Community 16 - "Synthetic Demand Generation"
Cohesion: 0.29
Nodes (10): generate(), main(), normalise_flow_rate(), Path, Generate traffic demand for the Barcelona network. *** SYNTHETIC DATA -- READ…, Force the flows in `routes` to collectively emit one vehicle per `period`.…, Superseded by strip_vtypes; kept only to document why it cannot work., Remove vType/vTypeDistribution definitions from a routed file, so that… (+2 more)

### Community 17 - "OSM Building Fetch"
Cohesion: 0.25
Nodes (10): build_query(), expand_bbox(), fetch(), parse_height(), parse_min_height(), Fetch real Barcelona building footprints from OpenStreetMap. REAL DATA. Every…, Rough planar area, only used to discard slivers., Grow a bbox about its centre by `factor` in each linear dimension. (+2 more)

### Community 18 - "Camera Presets"
Cohesion: 0.40
Nodes (4): flyToPreset(), haversineKm(), INITIAL, PRESETS

### Community 19 - "SUMO Network Build"
Cohesion: 0.60
Nodes (4): build_network(), _exe(), Convert the OSM extract into a SUMO network, then generate demand. Stage 1…, run()

### Community 20 - "GeoJSON Export"
Cohesion: 0.67
Nodes (3): classify_corridor(), main(), Export the SUMO network to GeoJSON for the web map. Everything written here is…

### Community 21 - "Bounded AI Control Rationale"
Cohesion: 0.67
Nodes (3): Rules Over Reinforcement Learning, Policy Bounds Clamped Twice, Strategic / Tactical Split

### Community 22 - "Dead Reckoning Wire Contract"
Cohesion: 0.67
Nodes (3): Dead Reckoning, Instance Slot Instability, Binary Wire Format

## Knowledge Gaps
- **99 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+94 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `run_worker()` connect `A/B Measurement Harnesses` to `Adaptive Signal Controller`, `FastAPI Server Endpoints`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `Engine` connect `Twin Orchestration Engine` to `AI Role Configuration`, `A/B Measurement Harnesses`, `FastAPI Server Endpoints`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `run_worker()` (e.g. with `.start()` and `run_point()`) actually correct?**
  _`run_worker()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `RoleConfig` (e.g. with `Emulator` and `Orchestrator`) actually correct?**
  _`RoleConfig` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _99 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `AI Role Configuration` be split into smaller, more focused modules?**
  _Cohesion score 0.06412583182093164 - nodes in this community are weakly interconnected._
- **Should `Adaptive Signal Controller` be split into smaller, more focused modules?**
  _Cohesion score 0.05137844611528822 - nodes in this community are weakly interconnected._