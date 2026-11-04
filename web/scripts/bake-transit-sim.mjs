/**
 * The centre's response to fewer cars, and to AI signals, measured once.
 *
 *   node scripts/bake-transit-sim.mjs pristina
 *
 * Adds `sim` to public/transit/<slug>.json: the city's traffic twin run with
 * the page's fleet and with 5-30% of it removed, under fixed timing and under
 * the neural controller, three seeds each.
 *
 * WHY BAKED, AND WHY SEEDS
 * Per click, four single-seed runs took ~17 s and could not tell an effect
 * from noise: removing ONE car read as +15% stopped time on one seed and -3%
 * on another. Three seeds per point, done once here, let the page show a
 * range and say plainly when it spans zero -- and answer instantly.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CITIES, bbox, citySlug } from '../src/city/cities.js'
import { buildGraph, expandOsm } from '../src/city/osm.js'
import { checkModel } from '../src/city/neural.js'
import { centreEffect } from '../src/transit/scenario.js'

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
export const SHARES = [0.05, 0.1, 0.2, 0.3]
export const SEEDS = [7, 11, 13]

for (const slug of process.argv.slice(2)) {
  const city = CITIES.find((c) => citySlug(c) === slug)
  const g = buildGraph(expandOsm(JSON.parse(readFileSync(join(PUB, 'cities', `${slug}.json`), 'utf8'))), bbox(city))
  const model = checkModel(JSON.parse(readFileSync(join(PUB, 'models', 'signal-controller.json'), 'utf8')))
  const vehicles = Math.min(420, Math.max(90, Math.round(g.stats.km * 12)))
  const points = []
  for (const share of SHARES) {
    // centreEffect removes simultaneous(cars) vehicles; ask for the cars/hour
    // that make `share` of the fleet, at its 7-minute crossing time.
    const cars = Math.round((share * vehicles * 60) / 7)
    const runs = []
    for (const seed of SEEDS) {
      const r = await centreEffect(g, { vehicles, cars, model, seed })
      runs.push({ seed, removed: r.removed, base: r.base, shifted: r.shifted })
    }
    points.push({ share, runs })
    console.log(`  ${slug} ${Math.round(share * 100)}%: removed ${runs[0].removed}`)
  }
  const file = join(PUB, 'transit', `${slug}.json`)
  const data = JSON.parse(readFileSync(file, 'utf8'))
  data.sim = { vehicles, seconds: 300, seeds: SEEDS, controller: 'neural', points, generated: new Date().toISOString() }
  writeFileSync(file, JSON.stringify(data))
  console.log(`baked  ${slug} sim: ${vehicles} vehicles, ${SHARES.length} shares x ${SEEDS.length} seeds`)
}
