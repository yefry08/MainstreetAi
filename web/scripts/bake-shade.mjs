/**
 * Shade on a district's streets and bike lanes, hour by hour, from the real sun,
 * every building's height and every mapped tree (src/green/shade.js).
 *
 *   node scripts/bake-shade.mjs santo-domingo [--date 2026-07-15]
 *
 * Reads the Green tab's result for the same area (public/green/<slug>.json --
 * its bike network and planting candidates) and adds, for HOURS:
 *   - the share of the whole bike network in shade,
 *   - each bike-lane piece's and each candidate street's shade,
 * written to public/shade/<slug>.json.
 *
 * The default date is mid-July: the hottest stretch of Santo Domingo's year,
 * which is when shade on a bike lane matters.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchCity } from '../src/city/osm.js'
import { projector } from '../src/transit/coverage.js'
import { heightOf, localDate, shadedShare, shadeIndex, shadows, sunPosition } from '../src/green/shade.js'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(WEB, '.cache', 'shade')
const OUT = join(WEB, 'public', 'shade')
mkdirSync(CACHE, { recursive: true }); mkdirSync(OUT, { recursive: true })

const AREAS = { 'santo-domingo': { iso: 'DO-01', box: [18.415, -70.005, 18.535, -69.870] } }
export const HOURS = [9, 12, 15, 17]
const args = process.argv.slice(2)
const slug = args.find((a) => !a.startsWith('--') && !/^\d{4}-/.test(a)) ?? 'santo-domingo'
const di = args.indexOf('--date')
const [Y, M, D] = (di >= 0 ? args[di + 1] : '2026-07-15').split('-').map(Number)
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000))

const query = (iso, [s, w, n, e]) => `[out:json][timeout:180];
area["ISO3166-2"="${iso}"]["boundary"="administrative"]->.a;
way["building"](area.a)(${s},${w},${n},${e});
out tags geom;
node["natural"="tree"](area.a)(${s},${w},${n},${e});
out skel;`

function tiles([s, w, n, e], k = 4) {
  const out = []
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    out.push([s + ((n - s) * i) / k, w + ((e - w) * j) / k, s + ((n - s) * (i + 1)) / k, w + ((e - w) * (j + 1)) / k])
  }
  return out
}

const area = AREAS[slug]
const green = JSON.parse(readFileSync(join(WEB, 'public', 'green', `${slug}.json`), 'utf8'))
const centre = green.centre
const p = projector(centre[0], centre[1])

// ---- buildings and trees, tiled and cached ---------------------------------
const els = new Map()
for (const [i, t] of tiles(area.box).entries()) {
  const file = join(CACHE, `${slug}_${i}.json`)
  let got = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
  for (const pause of got ? [] : [0, 30, 90, 180]) {
    if (pause) await sleep(pause)
    try {
      got = (await fetchCity(t, { ql: query(area.iso, t), timeoutMs: 240000, allowEmpty: true,
        headers: { 'User-Agent': 'mainstreetai-bake/1.0 (github.com/yefry08/MainstreetAi)' } })).elements
      writeFileSync(file, JSON.stringify(got)); break
    } catch (e) { console.log(`retry  tile ${i + 1}/16: ${e.message.slice(0, 80)}`) }
  }
  if (!got) { console.log(`FAIL   tile ${i + 1}/16 (finished tiles are cached; run again)`); process.exit(1) }
  for (const el of got) els.set(`${el.type}/${el.id}`, el)
  console.log(`  tile ${i + 1}/16: ${got.length}`)
}

const buildings = [], trees = []
let assumed = 0
for (const el of els.values()) {
  if (el.type === 'node') { trees.push(p.xy(el.lat, el.lon)); continue }
  if (!el.geometry || el.geometry.length < 4) continue
  const { h, assumed: a } = heightOf(el.tags)
  if (a) assumed++
  buildings.push({ ring: el.geometry.map((g) => p.xy(g.lat, g.lon)), h })
}
console.log(`buildings ${buildings.length} (${Math.round((assumed / Math.max(buildings.length, 1)) * 100)}% height assumed), trees ${trees.length}`)

// ---- shade per hour -----------------------------------------------------------
const toXY = (line) => line.map(([lon, lat]) => p.xy(lat, lon))
const len = (l) => l.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - l[i][0], q[1] - l[i][1]), 0)
const bike = green.bike.lines.map(toXY)
const plant = green.planting.map((g) => g.lines.map(toXY))
const hours = []
for (const hour of HOURS) {
  const sun = sunPosition(localDate(Y, M, D, hour), centre[0], centre[1])
  const isShaded = shadeIndex(shadows(buildings, trees, sun))
  let shadedM = 0, totalM = 0
  const bikeShare = bike.map((l) => {
    const s = shadedShare(l, isShaded), L = len(l)
    shadedM += s * L; totalM += L
    return Math.round(s * 100) / 100
  })
  const plantShare = plant.map((ls) => {
    const L = ls.reduce((s, l) => s + len(l), 0)
    return Math.round((ls.reduce((s, l) => s + shadedShare(l, isShaded) * len(l), 0) / Math.max(L, 1)) * 100) / 100
  })
  hours.push({ hour, altitude: Math.round((sun.altitude * 180) / Math.PI), azimuth: Math.round((sun.azimuth * 180) / Math.PI),
               bikeShaded: Math.round((shadedM / Math.max(totalM, 1)) * 100) / 100, bike: bikeShare, planting: plantShare })
  console.log(`  ${hour}:00  sun ${hours.at(-1).altitude} deg  bike network ${Math.round(hours.at(-1).bikeShaded * 100)}% in shade`)
}
writeFileSync(join(OUT, `${slug}.json`), JSON.stringify({ slug, date: `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`,
  buildings: buildings.length, heightAssumedShare: Math.round((assumed / Math.max(buildings.length, 1)) * 100) / 100,
  trees: trees.length, hours, generated: new Date().toISOString() }))
console.log(`baked  shade ${slug}`)
