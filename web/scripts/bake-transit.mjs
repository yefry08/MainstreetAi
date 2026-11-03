/**
 * Bake a city's bus network and route-review flags from OpenStreetMap.
 *
 *   node scripts/bake-transit.mjs            # every city in TRANSIT
 *   node scripts/bake-transit.mjs pristina
 *
 * Output: public/transit/<slug>.json -- stops, bus routes (simplified lines),
 * and the cells where many homes have no stop within walking distance
 * (src/transit/coverage.js), each with the OSM ids behind it.
 *
 * The area is the whole city, not the 2.5 km traffic extract: coverage gaps
 * are on the edge, in exactly the new neighbourhoods the use case is about.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchCity } from '../src/city/osm.js'
import { coverageGaps } from '../src/transit/coverage.js'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'transit')
mkdirSync(OUT, { recursive: true })

// [south, west, north, east]: Pristina's built-up area, centre to ring road.
export const TRANSIT = {
  pristina: { name: 'Pristina', centre: [42.6629, 21.1655], bbox: [42.615, 21.100, 42.700, 21.230] },
}

// Buildings people live in. Most of Pristina's are tagged plain building=yes,
// so those count too when they stand inside a residential landuse area.
const HOME = '^(apartments|residential|house|detached|semidetached_house|terrace|dormitory)$'

// Stops are searched this far beyond the area. Without it, homes on the edge
// looked unserved because their nearest stop was just outside the box -- the
// first bake's worst "gaps" were all on the west edge for exactly that reason.
const STOP_PAD_DEG = 0.006   // ~600 m

const ql = ([s, w, n, e]) => {
  const p = STOP_PAD_DEG
  const sb = `${s - p},${w - p},${n + p},${e + p}`
  return `[out:json][timeout:180];
(
  node["highway"="bus_stop"](${sb});
  node["public_transport"="platform"]["bus"="yes"](${sb});
  node["public_transport"="stop_position"]["bus"="yes"](${sb});
)->.stops;
.stops out body;
relation["route"="bus"](${s},${w},${n},${e});
out geom;
way["landuse"="residential"](${s},${w},${n},${e})->.res;
.res map_to_area->.resArea;
(
  way["building"~"${HOME}"](${s},${w},${n},${e});
  way["building"="yes"](area.resArea);
);
out center;`
}

const r5 = (v) => Math.round(v * 1e5) / 1e5
const PAUSES_S = [0, 30, 90, 180]
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000))

/** Douglas-Peucker on [lat, lon] pairs, tolerance in degrees (~5 m). */
function simplify(pts, tol = 0.00005) {
  if (pts.length < 3) return pts
  const [a, b] = [pts[0], pts.at(-1)]
  let idx = 0, max = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const [y, x] = pts[i], [y1, x1] = a, [y2, x2] = b
    const d = Math.abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1) / (Math.hypot(y2 - y1, x2 - x1) || 1)
    if (d > max) { max = d; idx = i }
  }
  if (max <= tol) return [a, b]
  return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)]
}

async function bake(slug) {
  const c = TRANSIT[slug]
  let osm = null
  for (const pause of PAUSES_S) {
    if (pause) { console.log(`  waiting ${pause}s…`); await sleep(pause) }
    try {
      osm = await fetchCity(c.bbox, {
        ql: ql(c.bbox), timeoutMs: 240000,
        headers: { 'User-Agent': 'mainstreetai-bake/1.0 (github.com/yefry08/MainstreetAi)' },
      })
      break
    } catch (e) { console.log(`retry  ${slug}: ${e.message.slice(0, 160)}`) }
  }
  if (!osm) throw new Error(`${slug}: OpenStreetMap did not answer`)

  const stops = new Map()
  const routes = []
  const homes = new Map()
  for (const el of osm.elements) {
    if (el.type === 'node' && el.lat != null) {
      stops.set(`node/${el.id}`, { id: `node/${el.id}`, lat: r5(el.lat), lon: r5(el.lon), name: el.tags?.name ?? null })
    } else if (el.type === 'relation') {
      const lines = (el.members ?? [])
        .filter((m) => m.type === 'way' && m.geometry?.length)
        .map((m) => simplify(m.geometry.map((g) => [r5(g.lat), r5(g.lon)])))
      routes.push({ id: `relation/${el.id}`, ref: el.tags?.ref ?? null, name: el.tags?.name ?? null,
                    operator: el.tags?.operator ?? null, lines })
    } else if (el.type === 'way' && el.center) {
      // A residential area that crosses the edge brings in homes beyond it.
      const [s, w, n, e] = c.bbox
      if (el.center.lat < s || el.center.lat > n || el.center.lon < w || el.center.lon > e) continue
      homes.set(`way/${el.id}`, { id: `way/${el.id}`, lat: el.center.lat, lon: el.center.lon })
    }
  }

  const gaps = coverageGaps({ homes: [...homes.values()], stops: [...stops.values()], centre: c.centre })
  const out = {
    city: c.name, slug, centre: c.centre, bbox: c.bbox,
    generated: new Date().toISOString(),
    source: 'OpenStreetMap contributors (ODbL), via Overpass',
    stops: [...stops.values()],
    routes: routes.sort((a, b) => String(a.ref).localeCompare(String(b.ref), 'en', { numeric: true })),
    gaps: gaps.cells.map((g) => ({ ...g, lat: r5(g.lat), lon: r5(g.lon) })),
    totals: gaps.totals,
  }
  const file = join(OUT, `${slug}.json`)
  writeFileSync(file, JSON.stringify(out))
  const t = gaps.totals
  console.log(`baked  ${slug}: ${t.stops} stops, ${routes.length} routes, ${t.homes} homes, ` +
              `${(t.coveredShare * 100).toFixed(0)}% within ${t.walkM} m, ${out.gaps.length} flagged cells ` +
              `(${t.flaggedHomes} homes)`)
}

const names = process.argv.slice(2)
for (const slug of names.length ? names : Object.keys(TRANSIT)) await bake(slug)
