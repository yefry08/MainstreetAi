/**
 * Write public/cities/index.json: which ready-made cities actually exist.
 *
 *   node scripts/index-cities.mjs
 *
 * The picker promises "instant, works offline" for every city it lists under
 * ready-made. Without this index it listed the whole catalogue, so a city
 * whose bake had failed -- an overloaded Overpass, or too few traffic lights
 * to be worth running -- carried that promise and then quietly fell back to
 * a live download. The page now lists exactly the cities in this file, with
 * their real street and signal counts.
 *
 * Run automatically at the end of bake-cities.mjs.
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CITIES, bbox, citySlug } from '../src/city/cities.js'
import { buildGraph, expandOsm } from '../src/city/osm.js'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'cities')

export function writeIndex() {
  const cities = []
  for (const c of CITIES) {
    const slug = citySlug(c)
    const file = join(DIR, `${slug}.json`)
    if (!existsSync(file)) continue
    const g = buildGraph(expandOsm(JSON.parse(readFileSync(file, 'utf8'))), bbox(c))
    cities.push({
      slug,
      streets: g.stats.edges,
      signals: g.stats.signals,
      junctions: g.stats.junctions,
      estimatedSignals: g.stats.estimatedSignals,
    })
  }
  const tmp = join(DIR, 'index.json.tmp')
  writeFileSync(tmp, JSON.stringify({ v: 1, cities }))
  renameSync(tmp, join(DIR, 'index.json'))
  return cities
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cities = writeIndex()
  console.log(`index.json: ${cities.length} ready-made cities of ${CITIES.length} in the catalogue`)
  const missing = CITIES.map(citySlug).filter((s) => !cities.some((c) => c.slug === s))
  if (missing.length) console.log(`not baked: ${missing.join(', ')}`)
}
