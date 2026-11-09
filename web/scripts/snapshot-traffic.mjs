/**
 * A snapshot of a district's real congestion right now, from Mapbox Traffic,
 * to calibrate its SUMO twin against.
 *
 *   node scripts/snapshot-traffic.mjs santo-domingo
 *
 * Reads every mapbox.mapbox-traffic-v1 tile over the district (z14), keeps the
 * main roads (motorway to tertiary, the ones the twin's signals sit on) inside
 * the box, and measures road length at each congestion level. Appends the
 * result to web/.cache/traffic/<slug>.json (one entry per snapshot, with the
 * local time), so several peak-hour readings can be averaged.
 *
 * Needs VITE_MAPBOX_TOKEN in web/.env.local.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Pbf from 'pbf'
import { VectorTile } from '@mapbox/vector-tile'
import { tilesFor } from '../src/city/liveMapbox.js'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const AREAS = { 'santo-domingo': { box: [18.415, -70.005, 18.535, -69.870], utcOffset: -4 } }
const MAIN = /^(motorway|trunk|primary|secondary|tertiary)(_link)?$/
const LEVELS = ['low', 'moderate', 'heavy', 'severe']
const Z = 14

const slug = process.argv[2] ?? 'santo-domingo'
const A = AREAS[slug]
const env = readFileSync(join(WEB, '.env.local'), 'utf8')
const token = env.match(/^VITE_MAPBOX_TOKEN=(\S+)/m)?.[1]
if (!token) { console.log('no VITE_MAPBOX_TOKEN in web/.env.local'); process.exit(1) }

const [S, W, N, E] = A.box
const n = 2 ** Z
const y2lat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI
const lengths = Object.fromEntries(LEVELS.map((l) => [l, 0]))
let tilesOk = 0
// tilesFor takes [west, south, east, north]; the box here is [south, west, north, east].
const tiles = tilesFor([W, S, E, N], Z)
for (const [x, y] of tiles) {
  let res = null
  for (const pause of [0, 5, 20]) {
    if (pause) await new Promise((r) => setTimeout(r, pause * 1000))
    try { res = await fetch(`https://api.mapbox.com/v4/mapbox.mapbox-traffic-v1/${Z}/${x}/${y}.vector.pbf?access_token=${token}`, { signal: AbortSignal.timeout(20000) }); if (res.ok) break } catch { res = null }
  }
  if (!res?.ok) continue
  tilesOk++
  const layer = new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer()))).layers.traffic
  if (!layer) continue
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i)
    const lvl = f.properties.congestion
    if (!LEVELS.includes(lvl) || !MAIN.test(f.properties.class ?? '')) continue
    for (const ring of f.loadGeometry()) {
      for (let k = 1; k < ring.length; k++) {
        const lon1 = ((x + ring[k - 1].x / f.extent) / n) * 360 - 180, lat1 = y2lat(y + ring[k - 1].y / f.extent)
        const lon2 = ((x + ring[k].x / f.extent) / n) * 360 - 180, lat2 = y2lat(y + ring[k].y / f.extent)
        const mlat = (lat1 + lat2) / 2, mlon = (lon1 + lon2) / 2
        if (mlat < S || mlat > N || mlon < W || mlon > E) continue
        lengths[lvl] += Math.hypot((lat2 - lat1) * 110540, (lon2 - lon1) * 111320 * Math.cos((mlat * Math.PI) / 180))
      }
    }
  }
}
const total = LEVELS.reduce((s, l) => s + lengths[l], 0)
const shares = Object.fromEntries(LEVELS.map((l) => [l, total ? +(lengths[l] / total).toFixed(4) : 0]))
const now = new Date()
const local = new Date(now.getTime() + A.utcOffset * 3600e3)
const entry = { utc: now.toISOString(), local: local.toISOString().slice(0, 16).replace('T', ' '), day: local.getUTCDay(),
                tiles: `${tilesOk}/${tiles.length}`, mainKm: +(total / 1000).toFixed(1), shares,
                congested: +(1 - shares.low).toFixed(4) }
const dir = join(WEB, '.cache', 'traffic'); mkdirSync(dir, { recursive: true })
const file = join(dir, `${slug}.json`)
const all = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []
all.push(entry)
writeFileSync(file, JSON.stringify(all, null, 1))
console.log(`snapshot ${slug} ${entry.local} (local): ${entry.mainKm} km of main road, ` +
            `congested ${(entry.congested * 100).toFixed(1)}% ` +
            `(moderate ${(shares.moderate * 100).toFixed(1)}%, heavy ${(shares.heavy * 100).toFixed(1)}%, severe ${(shares.severe * 100).toFixed(1)}%), tiles ${entry.tiles}`)
