/**
 * Shade: how much of a street is in shadow at a given day and hour, from the
 * real sun position, building heights and trees.
 *
 * "No mapped tree" is a poor proxy for heat: a street between six-storey
 * blocks can be shaded all afternoon, and a wide avenue with a row of young
 * trees can be in full sun at 15:00. So shade is computed:
 *   1. the sun's azimuth and altitude for the place, date and time (the
 *      standard low-precision solar position, as in SunCalc -- accurate to a
 *      fraction of a degree, far inside what footprints support);
 *   2. each building's shadow: its footprint swept away from the sun by
 *      height / tan(altitude), as the convex hull of footprint and offset copy
 *      (exact for convex footprints, close for the rest);
 *   3. each tree's shadow: a canopy disc offset the same way;
 *   4. points every SAMPLE_M along each street, shaded if inside any shadow.
 *
 * HEIGHTS: OSM `height`, else `building:levels` x 3 m, else DEFAULT_H -- two
 * storeys, the commonest building in Santo Domingo's neighbourhoods. The page
 * reports how many heights were assumed. Terrain is ignored (the Distrito
 * Nacional is nearly flat).
 */

export const SAMPLE_M = 10
export const DEFAULT_H = 6
export const TREE_H = 8
export const TREE_R = 4

const RAD = Math.PI / 180
const DAY_MS = 86400000
const J1970 = 2440588, J2000 = 2451545
const toDays = (date) => date.valueOf() / DAY_MS - 0.5 + J1970 - J2000
const E = RAD * 23.4397

/** Sun position: azimuth (radians, clockwise from north) and altitude (radians). */
export function sunPosition(date, lat, lon) {
  const lw = RAD * -lon, phi = RAD * lat, d = toDays(date)
  const M = RAD * (357.5291 + 0.98560028 * d)
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M))
  const L = M + C + RAD * 102.9372 + Math.PI
  const dec = Math.asin(Math.sin(L) * Math.sin(E))
  const ra = Math.atan2(Math.sin(L) * Math.cos(E), Math.cos(L))
  const H = RAD * (280.16 + 360.9856235 * d) - lw - ra
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H))
  // SunCalc's azimuth is from south, clockwise towards west; turn it to from-north.
  const azS = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi))
  return { azimuth: (azS + Math.PI) % (2 * Math.PI), altitude: alt }
}

/** Local wall-clock time in a fixed-offset zone (Santo Domingo is UTC-4, no DST). */
export const localDate = (y, m, d, hour, utcOffset = -4) =>
  new Date(Date.UTC(y, m - 1, d, hour - utcOffset, (hour % 1) * 60))

/** Offset (metres, x east y north) a point of height h casts its shadow to. */
export function shadowOffset(h, sun) {
  if (sun.altitude <= 0.02) return null            // sun down or on the horizon: all shade
  const len = Math.min(h / Math.tan(sun.altitude), 400)
  // Shadow points away from the sun.
  return [-Math.sin(sun.azimuth) * len, -Math.cos(sun.azimuth) * len]
}

function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo = [], up = []
  for (const q of p) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q) }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q) }
  return lo.slice(0, -1).concat(up.slice(0, -1))
}

function inside([x, y], poly) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

/**
 * Shadow shapes for one sun position. buildings: [{ring: [[x,y]...], h}],
 * trees: [[x,y]] -- all in local metres. Returns {polys, discs, night}.
 */
export function shadows(buildings, trees, sun) {
  if (sun.altitude <= 0.02) return { polys: [], discs: [], night: true }
  const polys = []
  for (const b of buildings) {
    const [dx, dy] = shadowOffset(b.h, sun)
    polys.push(hull(b.ring.concat(b.ring.map(([x, y]) => [x + dx, y + dy]))))
  }
  const [tx, ty] = shadowOffset(TREE_H, sun)
  // A canopy's shadow: the disc moved most of the way along the shadow line.
  const discs = trees.map(([x, y]) => [x + tx * 0.75, y + ty * 0.75])
  return { polys, discs, night: false }
}

/** A spatial index over shadow shapes, for the point test. */
export function shadeIndex({ polys, discs, night }, cell = 50) {
  const grid = new Map()
  const put = (k, v) => { if (!grid.has(k)) grid.set(k, []); grid.get(k).push(v) }
  for (const poly of polys) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
    for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++)
      for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) put(`${gx},${gy}`, { poly })
  }
  for (const d of discs) put(`${Math.floor(d[0] / cell)},${Math.floor(d[1] / cell)}`, { disc: d })
  return (p) => {
    if (night) return true
    const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell)
    for (let i = gx - 1; i <= gx + 1; i++) for (let j = gy - 1; j <= gy + 1; j++) {
      for (const s of grid.get(`${i},${j}`) ?? []) {
        if (s.disc ? Math.hypot(p[0] - s.disc[0], p[1] - s.disc[1]) <= TREE_R : (i === gx && j === gy && inside(p, s.poly))) return true
      }
    }
    return false
  }
}

/** Points every SAMPLE_M along a polyline of [x, y] metres. */
export function samples(line) {
  const out = []
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i]
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / SAMPLE_M))
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n])
  }
  if (line.length) out.push(line.at(-1))
  return out
}

/** Share (0..1) of a polyline's sample points in shade. */
export function shadedShare(line, isShaded) {
  const pts = samples(line)
  return pts.length ? pts.filter(isShaded).length / pts.length : 0
}

/** A building's height from OSM tags, and whether it had to be assumed. */
export function heightOf(tags = {}) {
  const h = parseFloat(tags.height)
  if (Number.isFinite(h) && h > 0) return { h, assumed: false }
  const lv = parseFloat(tags['building:levels'])
  if (Number.isFinite(lv) && lv > 0) return { h: lv * 3 + (parseFloat(tags['roof:levels']) || 0) * 2, assumed: false }
  return { h: DEFAULT_H, assumed: true }
}
