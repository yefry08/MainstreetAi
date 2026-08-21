/**
 * Congestion ramp: mean speed / speed limit -> colour.
 *
 * Free-flowing roads sink toward the basemap so the eye ignores them; jammed
 * ones burn. That asymmetry is the point — on a network of 4,016 edges you want
 * to see the problem, not the whole graph.
 *
 * Minor streets are dimmed by tier so the arterial picture stays legible at
 * city zoom instead of dissolving into a lit-up grid.
 *
 * Note these are NOT the signal colours from tokens.css. A jammed road and a
 * red light are different facts and must not be the same red; the ramp's
 * "stop-and-go" tone is deliberately pinker than `--signal-red`.
 */

const STOPS = [
  [0.72, [0.25, 0.33, 0.41]], // free flow — cool, recedes
  [0.52, [0.27, 0.75, 0.59]],
  [0.36, [0.90, 0.80, 0.31]],
  [0.20, [0.96, 0.57, 0.22]],
  [0.00, [0.94, 0.24, 0.29]], // stop-and-go
]

const TIER_ALPHA = { arterial: 0.9, distributor: 0.68, local: 0.42 }

/** Returns [r, g, b, a], all 0..1. `v` is the raw 0..255 byte from the wire. */
export function congestionRGBA(v, tier) {
  const r = v / 255
  let rgb = STOPS[STOPS.length - 1][1]
  for (const [threshold, c] of STOPS) {
    if (r > threshold) {
      rgb = c
      break
    }
  }
  return [rgb[0], rgb[1], rgb[2], TIER_ALPHA[tier] ?? 0.7]
}

export const CONGESTION_LEGEND = [
  ['#405469', 'free flow'],
  ['#46bf96', 'light'],
  ['#e6cc4f', 'busy'],
  ['#f59138', 'heavy'],
  ['#f03e4a', 'stop-and-go'],
]
