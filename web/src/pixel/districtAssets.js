/**
 * Where a district's traffic assets live.
 *
 * Barcelona keeps the unsuffixed names -- `replay/`, `signal_approaches.geojson`
 * -- because the deployed page, the recorded runs and the server have all
 * referenced them by those exact names since before there was a second city.
 * Renaming them to `replay_barcelona/` for symmetry would be tidier and would
 * break every existing deployment for nothing.
 *
 * A district appears here only once it has a SUMO network AND a recording. The
 * others are basemaps, and the scene draws them with no traffic rather than
 * borrowing another city's.
 */
const WITH_TRAFFIC = new Set(['barcelona', 'shibuya', 'manhattan'])

export const hasTraffic = (district) => WITH_TRAFFIC.has(district)

const suffix = (district) => (district === 'barcelona' ? '' : `_${district}`)

export const replayDir = (district, base = './') =>
  `${base}replay${suffix(district)}`

export const signalsPath = (district, base = './') =>
  `${base}data/signal_approaches${suffix(district)}.geojson`

export const basemapPath = (district, base = './') =>
  `${base}data/basemap_${district}.json`
