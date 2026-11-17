---
title: MainstreetAi Ablation
emoji: 🚦
colorFrom: green
colorTo: blue
sdk: static
app_file: index.html
short_description: What each piece of an AI traffic controller adds
---

# MainstreetAi: what each piece of the AI adds

Results of a 5-seed ablation on a SUMO digital twin of Santo Domingo's
Distrito Nacional (185 signals, OpenStreetMap network). Four arms run on
identical synthetic demand:

1. **fixed**: a generic 88 s fixed-time plan
2. **adaptive**: queue-based adaptive control
3. **adaptive+tsp**: plus transit signal priority for buses
4. **adaptive+tsp+forecast**: plus a hand-written forecast of event demand

The window runs from 7:15 to 9:00, after a 15-minute warm-up. Each step is
reported as a paired difference across seeds, with a 95% confidence interval.

**Limits.** Demand is synthetic and not calibrated against counts. The
baseline is not INTRANT's real timing plan. These are simulation results,
not field measurements.

- Live site: https://yefry08.github.io/MainstreetAi/
- Code: https://github.com/yefry08/MainstreetAi (`server/ablation.py`)
- Data: `ablation.json` in this Space
