/**
 * Where people live far from a bus stop: route-review flags from open data.
 *
 * For the GenAI for Good Challenge's Pristina use case ("highlight locations
 * where current evidence suggests a route may no longer match demand, without
 * recommending or making changes"). This is the part that needs no municipal
 * data: homes and bus stops from OpenStreetMap, gridded, and every cell with
 * many homes and no stop within walking distance flagged -- with the OSM
 * elements behind it, so a planner can check each flag at its source.
 *
 * WHAT A FLAG IS NOT: proof of unmet demand. OpenStreetMap can be missing
 * stops (a gap in the map, not in the service) and homes are a proxy for
 * riders. The page says both; the flag is a prompt to look, which is all the
 * use case asks for.
 */

export const WALK_M = 400        // the usual planning standard for a bus stop
export const CELL_M = 250
export const MIN_HOMES = 15       // fewer, and a "gap" is a few houses, not a neighbourhood

const R = 6371000
const rad = (d) => (d * Math.PI) / 180

/** Equirectangular metres around a reference point: fine at city scale. */
export function projector(lat0, lon0) {
  const kx = R * Math.cos(rad(lat0)) * (Math.PI / 180)
  const ky = R * (Math.PI / 180)
  return {
    xy: (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky],
    ll: (x, y) => [lat0 + y / ky, lon0 + x / kx],
  }
}

/** Nearest stop to a point, by a uniform grid so it stays fast at 50k homes. */
function stopIndex(stops, size = WALK_M * 2) {
  const grid = new Map()
  const key = (i, j) => `${i},${j}`
  for (const s of stops) {
    const k = key(Math.floor(s.x / size), Math.floor(s.y / size))
    if (!grid.has(k)) grid.set(k, [])
    grid.get(k).push(s)
  }
  return (x, y, ring = 3) => {
    const i0 = Math.floor(x / size), j0 = Math.floor(y / size)
    let best = null, bestD = Infinity
    for (let i = i0 - ring; i <= i0 + ring; i++) {
      for (let j = j0 - ring; j <= j0 + ring; j++) {
        for (const s of grid.get(key(i, j)) ?? []) {
          const d = Math.hypot(s.x - x, s.y - y)
          if (d < bestD) { bestD = d; best = s }
        }
      }
    }
    return { stop: best, d: bestD }
  }
}

/**
 * homes: [{id, lat, lon}] (OSM residential buildings), stops: [{id, lat, lon, name}].
 * Returns { cells: [flagged cells, worst first], totals }.
 * A cell: {lat, lon, homes, nearestM, nearestStop, homeIds (up to 5)}.
 */
export function coverageGaps({ homes, stops, centre, walkM = WALK_M, cellM = CELL_M, minHomes = MIN_HOMES }) {
  const p = projector(centre[0], centre[1])
  const S = stops.map((s) => { const [x, y] = p.xy(s.lat, s.lon); return { ...s, x, y } })
  const nearest = stopIndex(S)

  let covered = 0
  const cells = new Map()
  for (const h of homes) {
    const [x, y] = p.xy(h.lat, h.lon)
    const { stop, d } = nearest(x, y)
    if (d <= walkM) { covered++; continue }
    const k = `${Math.floor(x / cellM)},${Math.floor(y / cellM)}`
    const c = cells.get(k) ?? { homes: 0, sx: 0, sy: 0, nearestM: Infinity, nearestStop: null, homeIds: [] }
    c.homes++; c.sx += x; c.sy += y
    if (d < c.nearestM) { c.nearestM = d; c.nearestStop = stop }
    if (c.homeIds.length < 5) c.homeIds.push(h.id)
    cells.set(k, c)
  }

  const flagged = [...cells.values()]
    .filter((c) => c.homes >= minHomes)
    .map((c) => {
      const [lat, lon] = p.ll(c.sx / c.homes, c.sy / c.homes)
      return {
        lat, lon, homes: c.homes,
        nearestM: Number.isFinite(c.nearestM) ? Math.round(c.nearestM) : null,
        nearestStop: c.nearestStop && { id: c.nearestStop.id, name: c.nearestStop.name ?? null,
                                        lat: c.nearestStop.lat, lon: c.nearestStop.lon },
        homeIds: c.homeIds,
      }
    })
    // Most homes first: a review list should open on the biggest gap.
    .sort((a, b) => b.homes - a.homes)

  return {
    cells: flagged,
    totals: {
      homes: homes.length, stops: stops.length, covered,
      coveredShare: homes.length ? covered / homes.length : 0,
      flaggedHomes: flagged.reduce((s, c) => s + c.homes, 0),
      walkM, cellM, minHomes,
    },
  }
}

/** OpenStreetMap link for an element id like "way/123" or "node/456". */
export const osmUrl = (id) => `https://www.openstreetmap.org/${id}`
