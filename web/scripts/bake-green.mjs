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
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CITIES, bbox, citySlug } from '../src/city/cities.js'
import { fetchCity } from '../src/city/osm.js'
import { analyseGreen, greenQuery } from '../src/green/plan.js'
import { trimGreen } from '../src/green/trim.js'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'green')
mkdirSync(OUT, { recursive: true })

const FEATURED = ['pristina', 'medellin', 'sao-paulo', 'rio-de-janeiro', 'monterrey', 'bogota',
                  'mexico-city', 'buenos-aires', 'lima', 'santiago']
const PAUSES_S = [0, 30, 90]
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000))

const slugs = process.argv.slice(2).length ? process.argv.slice(2) : FEATURED
for (const slug of slugs) {
  const city = CITIES.find((c) => citySlug(c) === slug)
  if (!city) { console.log(`skip   ${slug}: not in the catalogue`); continue }
  let osm = null
  for (const pause of PAUSES_S) {
    if (pause) await sleep(pause)
    try {
      osm = await fetchCity(bbox(city), { ql: greenQuery(bbox(city)), timeoutMs: 200000,
        headers: { 'User-Agent': 'mainstreetai-bake/1.0 (github.com/yefry08/MainstreetAi)' } })
      break
    } catch (e) { console.log(`retry  ${slug}: ${e.message.slice(0, 120)}`) }
  }
  if (!osm) { console.log(`FAIL   ${slug}`); continue }
  const r = trimGreen(analyseGreen(osm.elements, [city.lat, city.lon], bbox(city)))
  writeFileSync(join(OUT, `${slug}.json`), JSON.stringify({ slug, city: city.name, centre: [city.lat, city.lon],
    generated: new Date().toISOString(), source: 'OpenStreetMap contributors (ODbL), via Overpass', ...r }))
  console.log(`baked  ${slug}: ${r.trees.count} trees (${r.trees.perKm}/km of street${r.trees.sparse ? ', SPARSE' : ''}), ` +
              `${r.planting.length} planting streets, bike ${r.bike.existingKm} km in ${r.bike.pieces} pieces, ` +
              `${r.bike.connectors.length} connectors, ${r.bike.arterials.length} main streets without a lane`)
}
const have = readdirSync(OUT).filter((f) => f.endsWith('.json') && f !== 'index.json').map((f) => f.slice(0, -5))
writeFileSync(join(OUT, 'index.json'), JSON.stringify({ cities: have.sort() }))
console.log(`index  ${have.length} cities`)
