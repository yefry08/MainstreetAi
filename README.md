# MainstreetAi — static replay

This branch is **build output**, published to GitHub Pages. Do not edit it by
hand; it is regenerated.

## What this page is, and what it is not

GitHub Pages serves static files and cannot run Python. The live application
streams every vehicle position over a WebSocket from a SUMO microsimulation,
so deploying it here unchanged would show a basemap and nothing else.

This is therefore a **recording**: both twins were run on byte-identical demand
and captured, and the page plays those recordings back. The toggle switches
between two pre-recorded runs — it is not re-deciding anything while you watch.

Captured at simulated t=1,821 s with 1,168 vehicles, at the operating point the
published figures were validated at:

| metric | fixed-time | AI-adaptive | change |
|---|---:|---:|---:|
| Network speed | 14.8 km/h | 20.6 km/h | **+39.0 %** |
| Bus speed | 15.3 km/h | 27.9 km/h | **+83.0 %** |
| Time lost stopped | 255.8 veh·h | 130.4 veh·h | **−49.0 %** |

## Rebuild

    python sim/bake_replay.py --target 1800 --seconds 45 --hz 4
    cd web && VITE_REPLAY_ONLY=1 npx vite build --base=/MainstreetAi/ --outDir dist-pages

Source, and the reasoning behind every number above, is on `main`.
