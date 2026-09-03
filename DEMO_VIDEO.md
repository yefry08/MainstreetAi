# Demo video — shot list

Target: **90 seconds**. Hackathon judges watch dozens; the claim has to land in
the first fifteen.

Every number below is read from the committed recordings
(`web/public/replay*/manifest.json`), not from memory. If a recording is
re-baked, re-read them before recording narration.

---

## The one rule

**Screen-record the real thing.** The product is a simulation that visibly
runs — two Barcelonas side by side, disagreeing. Generated b-roll of a car in
the rain shows a judge nothing you built, and if it opens the video it invites
exactly the wrong question: *is any of this real?*

Where generated footage earns its place is the 5-second title card and any
establishing shot of a city you did **not** simulate. Use it as connective
tissue, never as evidence.

---

## Shot list

| # | Time | Shot | On screen | Narration |
|---|------|------|-----------|-----------|
| 1 | 0:00–0:06 | Title card | Logo, one line | "Cities already have the hardware to cut congestion. It's the traffic lights." |
| 2 | 0:06–0:20 | Home, night, panels hidden (`H`) | Barcelona, traffic flowing, signals lit | "This is Barcelona's real street network. Eleven and a half thousand streets, 3,230 signal lamps, from OpenStreetMap." |
| 3 | 0:20–0:35 | Show panels, sit on the impact rail | Vehicle-minutes, CO₂, wait, bus speed | "Two identical simulations run on identical demand. The only difference is who controls the lights." |
| 4 | 0:35–0:50 | **Toggle Fixed-time → AI-adaptive** — the money shot | Vehicle count drops 1,126 → 791 | "Same city, same cars, same hour. Fixed timing on the left. The adaptive controller on the right." |
| 5 | 0:50–1:02 | Hold on the numbers | +41.1% network speed | "Forty-one percent faster. Half the time lost sitting still. Buses move 86% quicker — no new lane, no new concrete." |
| 6 | 1:02–1:15 | Try your city → Shibuya, then Manhattan | Cards animate, districts load | "The pipeline re-runs anywhere. Shibuya. Midtown Manhattan — 426 signalled junctions." |
| 7 | 1:15–1:25 | Research tab, scroll the pipeline | Three phases | "No language model anywhere in it. SUMO, a rule-based controller, and six auditable rules." |
| 8 | 1:25–1:30 | End card | URL + repo | "MainstreetAi. Open source, and the numbers are reproducible." |

---

## Numbers, verbatim

Quote these exactly. Rounding up is the fastest way to lose a technical judge.

| | Barcelona | Shibuya | Manhattan |
|---|---|---|---|
| Network speed | **+41.1%** | +36.0% | +34.6% |
| Time lost stopped | **−50.1%** | −58.7% | −61.9% |
| Bus speed | **+86.4%** | +56.5% | +71.3% |
| Driver wait (p95) | −12.8% | −70.1% | −63.5% |
| CO₂ avoided | 1,544 kg | 78 kg | 76 kg |
| Vehicle-minutes saved | 18,945 | 865 | 1,200 |

Say **"in simulation"** at least once. It costs two words and pre-empts the
first question every serious judge asks.

---

## Recording setup

```bash
python -m http.server 8110 --directory dist-pages
```

Open `http://localhost:8110` — the static build, so nothing depends on the
Python server staying alive mid-take.

- **1920×1080**, browser at 100% zoom, bookmarks bar hidden
- Press **`H`** to hide the panels for shots 2 and 6; press again to bring them back
- Let the basemap finish decoding **before** rolling — there is a visible pause on first load
- Night mode reads best on a projector; sunset is the prettiest for the title card

## Generated b-roll (optional)

Only after `HF_API_KEY_ID` / `HF_API_KEY_SECRET` are in `.env`:

```bash
python generate.py ltx-2.5-pro "Slow aerial over a dense European city grid at dusk, warm streetlights, cinematic" --name title-plate
```

Use it under the title card only. Do not cut it next to the simulation — a
photoreal street next to a pixel-art one makes the real work look like the
mock-up.
