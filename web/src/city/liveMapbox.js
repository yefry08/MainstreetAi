/**
 * Live congestion from Mapbox Traffic (the mapbox.mapbox-traffic-v1 tileset).
 *
 * Mapbox does not give speeds through its tiles; it gives each road a level --
 * low, moderate, heavy, severe -- recomputed every few minutes from live
 * probe data. This fetches the tiles covering a city's extract, keeps the road
 * segments inside it, and measures how many kilometres sit at each level.
 * Those shares become an approximate current/free-flow speed ratio
 * (LEVEL_RATIO), which liveTraffic.js turns into a fleet size like any other
 * provider's.
 *
 * LEVEL_RATIO is an approximation: Mapbox names the levels without publishing
 * the speed bands behind them. The page says the ratio is estimated.
 *
 * THE TOKEN is VITE_MAPBOX_TOKEN in web/.env.local (gitignored), a public
 * "pk." token: it ships in the bundle and is protected by the URL restriction
 * set in the Mapbox dashboard.
 */
import Pbf from 'pbf'
import { VectorTile } from '@mapbox/vector-tile'

export const MAPBOX_TOKEN = import.meta.env?.VITE_MAPBOX_TOKEN ?? ''

const TILES = 'https://api.mapbox.com/v4/mapbox.mapbox-traffic-v1'
const Z = 14
export const LEVEL_RATIO = { low: 0.9, moderate: 0.6, heavy: 0.4, severe: 0.2 }
export const LEVELS = Object.keys(LEVEL_RATIO)

const lon2x = (lon, n) => ((lon + 180) / 360) * n
const lat2y = (lat, n) => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n
}
const y2lat = (y, n) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI

/** Tile [x, y] pairs covering bounds [w, s, e, n] at zoom z. */
export function tilesFor([w, s, e, nth], z = Z) {
  const n = 2 ** z
  const out = []
  for (let x = Math.floor(lon2x(w, n)); x <= Math.floor(lon2x(e, n)); x++) {
    for (let y = Math.floor(lat2y(nth, n)); y <= Math.floor(lat2y(s, n)); y++) out.push([x, y])
  }
  return out
}

/**
 * Metres of road at each congestion level, inside bounds, for one tile's
 * features: [{congestion, rings: [[{x, y}, ...]], extent}] in tile units.
 * A segment counts if its midpoint is inside the bounds.
 */
export function levelLengths(features, z, tx, ty, [w, s, e, nth], into = {}) {
  const n = 2 ** z
  for (const f of features) {
    if (!(f.congestion in LEVEL_RATIO)) continue
    for (const ring of f.rings) {
      for (let i = 1; i < ring.length; i++) {
        const lon1 = ((tx + ring[i - 1].x / f.extent) / n) * 360 - 180
        const lat1 = y2lat(ty + ring[i - 1].y / f.extent, n)
        const lon2 = ((tx + ring[i].x / f.extent) / n) * 360 - 180
        const lat2 = y2lat(ty + ring[i].y / f.extent, n)
        const mlon = (lon1 + lon2) / 2, mlat = (lat1 + lat2) / 2
        if (mlon < w || mlon > e || mlat < s || mlat > nth) continue
        const dx = (lon2 - lon1) * 111320 * Math.cos((mlat * Math.PI) / 180)
        const dy = (lat2 - lat1) * 110540
        into[f.congestion] = (into[f.congestion] ?? 0) + Math.hypot(dx, dy)
      }
    }
  }
  return into
}

/** Metres per level -> {ratio, km, shares}, or null if there is no road. */
export function summariseLevels(lengths) {
  const total = LEVELS.reduce((t, l) => t + (lengths[l] ?? 0), 0)
  if (total < 200) return null
  const shares = Object.fromEntries(LEVELS.map((l) => [l, (lengths[l] ?? 0) / total]))
  const ratio = LEVELS.reduce((r, l) => r + shares[l] * LEVEL_RATIO[l], 0)
  return { ratio, km: total / 1000, shares }
}

/** Decoded features of a tile's "traffic" layer, in levelLengths' shape. */
export function decodeTile(buf) {
  const layer = new VectorTile(new Pbf(buf)).layers.traffic
  if (!layer) return []
  const out = []
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i)
    out.push({ congestion: f.properties.congestion, rings: f.loadGeometry(), extent: f.extent })
  }
  return out
}

/** Congestion across bounds [w, s, e, n], or null. Throws only AbortError. */
export async function mapboxCongestion(bounds, { token = MAPBOX_TOKEN, signal } = {}) {
  if (!token) return null
  const lengths = {}
  await Promise.all(tilesFor(bounds).map(async ([x, y]) => {
    try {
      const res = await fetch(`${TILES}/${Z}/${x}/${y}.vector.pbf?access_token=${encodeURIComponent(token)}`, { signal })
      if (!res.ok) return
      levelLengths(decodeTile(new Uint8Array(await res.arrayBuffer())), Z, x, y, bounds, lengths)
    } catch (err) {
      if (err.name === 'AbortError') throw err
    }
  }))
  return summariseLevels(lengths)
}
