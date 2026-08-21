// Shared palette. Kept in one place so the map, the legend and the dashboard
// can never drift apart on what "bus orange" means.

export const CARS = {
  moving: [150, 170, 200],
  stopped: [255, 96, 88],
}
export const BUSES = {
  moving: [255, 138, 40],
  stopped: [255, 70, 50],
}
export const BIKES = {
  moving: [60, 214, 245],
  stopped: [90, 160, 200],
}

// Kept in sync with design/tokens.css by hand — these two are needed as JS
// values for inline styles and deck.gl colour arrays.
//
// The semantic pairing is the point: the AI twin is warm, the baseline twin is
// drained. The old amber baseline was replaced because it was indistinguishable
// from a signal amber on the map.
export const AI_COLOR = '#d97757'    // --terracotta-500
export const BASE_COLOR = '#8a94a6'  // --slate-400

/**
 * Congestion ramp, keyed on (mean speed / speed limit) * 255.
 * Free-flowing roads recede into the basemap; jammed ones burn red. Minor
 * streets are dimmed so the arterial picture reads at a glance.
 */
export function congestionColor(v, tier) {
  const r = v / 255
  let c
  if (r > 0.72) c = [56, 92, 120]        // free flow: cool, low contrast
  else if (r > 0.52) c = [70, 190, 150]
  else if (r > 0.36) c = [230, 205, 80]
  else if (r > 0.20) c = [245, 145, 55]
  else c = [240, 62, 74]                 // stop-and-go

  if (tier === 'local') return [c[0], c[1], c[2], 105]
  if (tier === 'distributor') return [c[0], c[1], c[2], 165]
  return [c[0], c[1], c[2], 220]
}

export const CONGESTION_LEGEND = [
  ['#385c78', 'free flow'],
  ['#46be96', 'light'],
  ['#e6cd50', 'busy'],
  ['#f59137', 'heavy'],
  ['#f03e4a', 'stop-and-go'],
]
