/**
 * Bake the Green tab's analysis for ready-made cities, so they open instantly.
 *
 *   node scripts/bake-green.mjs                 # the FEATURED list
 *   node scripts/bake-green.mjs medellin lima
 *
 * Output: public/green/<slug>.json (src/green/plan.js's result, lists capped)
 * and public/green/index.json (which cities have one). Any other city is
 * analysed live in the browser from Overpass, by the same code.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CITIES, bbox, citySlug } from '../src/city/cities.js'
import { fetchCity } from '../src/city/osm.js'
import { analyseGreen, greenQuery } from '../src/green/plan.js'
import { trimGreen } from '../src/green/trim.js'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'green')
mkdirSync(OUT, { recursive: true })
const CACHE = join(dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'green')
mkdirSync(CACHE, { recursive: true })

const FEATURED = ['medellin', 'sao-paulo', 'rio-de-janeiro', 'monterrey', 'bogota',
                  'mexico-city', 'buenos-aires', 'lima', 'santiago']
// Whole administrative areas instead of the 2.5 km box: the area's own
// boundary from OpenStreetMap, by ISO 3166-2 code. `box` is its bounding box,
// used to clip ways that cross the boundary.
const AREAS = {
  'santo-domingo': {
    name: 'Santo Domingo — Distrito Nacional', iso: 'DO-01',
    centre: [18.4745, -69.9395], box: [18.415, -70.005, 18.535, -69.870], zoom: 12.3,
  },
}
// One tile of the area: inside its boundary AND inside the tile's box. A whole
// district in one query got 502/504 from every mirror; four tiles get through.
const areaQuery = (iso, [s, w, n, e]) => {
  const B = `area["ISO3166-2"="${iso}"]["boundary"="administrative"]->.a;`
  const b = `${s},${w},${n},${e}`
  return `[out:json][timeout:180];
${B}
(
  way["highway"~"^(primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|cycleway)$"](area.a)(${b});
  way["highway"~"^(path|footway|track)$"]["bicycle"="designated"](area.a)(${b});
);
out body geom;
node["natural"="tree"](area.a)(${b});
out skel;
way["natural"="tree_row"](area.a)(${b});
out geom;`
}
const tiles = ([s, w, n, e]) => {
  const ms = (s + n) / 2, mw = (w + e) / 2
  return [[s, w, ms, mw], [s, mw, ms, e], [ms, w, n, mw], [ms, mw, n, e]]
}
// Fetch with retries; ways on a tile edge come back twice, so merge by id.
async function fetchArea(area, slug) {
  const seen = new Map()
  for (const [i, t] of tiles(area.box).entries()) {
    let got = null
    for (const pause of [0, 30, 90, 180]) {
      if (pause) await sleep(pause)
      try {
        got = await fetchCity(t, { ql: areaQuery(area.iso, t), timeoutMs: 240000,
          headers: { 'User-Agent': 'mainstreetai-bake/1.0 (github.com/yefry08/MainstreetAi)' } })
        break
      } catch (e) { console.log(`retry  ${slug} tile ${i + 1}/4: ${e.message.slice(0, 100)}`) }
    }
    if (!got) return null
    for (const el of got.elements) seen.set(`${el.type}/${el.id}`, el)
    console.log(`  tile ${i + 1}/4: ${got.elements.length} elements`)
  }
  return { elements: [...seen.values()] }
}

const PAUSES_S = [0, 30, 90]
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000))

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const slugs = args.length ? args : FEATURED
for (const slug of slugs) {
  const city = CITIES.find((c) => citySlug(c) === slug)
  if (!city) { console.log(`skip   ${slug}: not in the catalogue`); continue }
  const area = AREAS[slug]
  const box = area?.box ?? bbox(city)
  const centre = area?.centre ?? [city.lat, city.lon]
  // Raw OSM is cached (web/.cache/green, gitignored) so a change to the
  // analysis can be re-baked without asking Overpass again; --refresh refetches.
  const cached = join(CACHE, `${slug}.json`)
  let osm = !process.argv.includes('--refresh') && existsSync(cached) ? JSON.parse(readFileSync(cached, 'utf8')) : null
  if (!osm && area) osm = await fetchArea(area, slug)
  for (const pause of osm ? [] : PAUSES_S) {
    if (pause) await sleep(pause)
    try {
      osm = await fetchCity(box, { ql: greenQuery(box), timeoutMs: 200000,
        headers: { 'User-Agent': 'mainstreetai-bake/1.0 (github.com/yefry08/MainstreetAi)' } })
      break
    } catch (e) { console.log(`retry  ${slug}: ${e.message.slice(0, 120)}`) }
  }
  if (!osm) { console.log(`FAIL   ${slug}`); continue }
  if (!existsSync(cached)) writeFileSync(cached, JSON.stringify({ elements: osm.elements }))
  const r = trimGreen(analyseGreen(osm.elements, centre, box))
  writeFileSync(join(OUT, `${slug}.json`), JSON.stringify({ slug, city: area?.name ?? city.name, centre,
    zoom: area?.zoom, area: area ? { iso: area.iso } : undefined,
    generated: new Date().toISOString(), source: 'OpenStreetMap contributors (ODbL), via Overpass', ...r }))
  console.log(`baked  ${slug}: ${r.trees.count} trees (${r.trees.perKm}/km of street${r.trees.sparse ? ', SPARSE' : ''}), ` +
              `${r.planting.length} planting streets, bike ${r.bike.existingKm} km in ${r.bike.pieces} pieces, ` +
              `${r.bike.connectors.length} connectors, ${r.bike.arterials.length} main streets without a lane`)
}
const have = readdirSync(OUT).filter((f) => f.endsWith('.json') && f !== 'index.json').map((f) => f.slice(0, -5))
writeFileSync(join(OUT, 'index.json'), JSON.stringify({ cities: have.sort() }))
console.log(`index  ${have.length} cities`)
