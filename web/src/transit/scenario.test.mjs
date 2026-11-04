/**
 * "If this area got a bus". Run: node src/transit/scenario.test.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { modeShift, simultaneous, centreEffect, readCurve, noEffect, DETOUR } from './scenario.js'
import { buildGraph, expandOsm } from '../city/osm.js'
import { CITIES, bbox, citySlug } from '../city/cities.js'

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `   ${detail}` : ''}`)
  if (!ok) failures++
}

const centre = [42.6629, 21.1655]
// 0.03 deg of latitude north of the centre: ~3.34 km.
const gap = { lat: 42.6929, lon: 21.1655, homes: 100 }
const s = modeShift({ gap, centre, driveShare: 0.4, switchShare: 0.25 })
check('cars = homes x drive share x switch share', s.cars === 10)
check('trip is straight line x detour', Math.abs(s.tripKm - 3.336 * DETOUR) < 0.02, `${s.tripKm.toFixed(2)} km`)
check('a day counts there and back', Math.abs(s.kmPerDay - s.cars * s.tripKm * 2) < 1e-9)
check('CO2 is in a sane range for ~87 km of urban driving', s.co2KgPerDay > 10 && s.co2KgPerDay < 30, `${s.co2KgPerDay.toFixed(1)} kg`)
check('nobody switching removes nothing', modeShift({ gap, centre, driveShare: 0.4, switchShare: 0 }).cars === 0)
check("Little's law: 60 cars an hour, 7 min each, is 7 at once", simultaneous(60) === 7)

// The real Pristina centre, short run: fewer cars must not make the remaining
// ones wait longer on average.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const city = CITIES.find((c) => citySlug(c) === 'pristina')
const g = buildGraph(expandOsm(JSON.parse(readFileSync(join(root, 'public', 'cities', 'pristina.json'), 'utf8'))), bbox(city))
const r = await centreEffect(g, { vehicles: 300, cars: 600, seconds: 240 })
check('600 cars/h at 7 min each removes 70 from the box', r.removed === 70)
check('fewer cars: each remaining one stops no longer (fixed timing)',
  r.shifted.fixed.stoppedS <= r.base.fixed.stoppedS * 1.02,
  `${r.base.fixed.stoppedS.toFixed(1)} -> ${r.shifted.fixed.stoppedS.toFixed(1)} s`)
check('the AI twin still beats fixed timing at the base fleet', r.base.ai.stoppedS <= r.base.fixed.stoppedS * 1.02,
  `${r.base.fixed.stoppedS.toFixed(1)} vs ${r.base.ai.stoppedS.toFixed(1)} s`)

// readCurve on a hand-made curve: two seeds, measured at 10% and 20%.
const run = (seed, fixedS, aiS, shiftedFixedS, shiftedAiS) => ({
  seed, base: { fixed: { stoppedS: fixedS, co2PerKm: 200 }, ai: { stoppedS: aiS, co2PerKm: 200 } },
  shifted: { fixed: { stoppedS: shiftedFixedS, co2PerKm: 190 }, ai: { stoppedS: shiftedAiS, co2PerKm: 190 } },
})
const sim = { seeds: [1, 2], points: [
  { share: 0.1, runs: [run(1, 10, 6, 9, 5), run(2, 10, 5, 11, 4)] },
  { share: 0.2, runs: [run(1, 10, 6, 8, 4), run(2, 10, 5, 10, 4)] },
] }
const c0 = readCurve(sim, 0)
check('at share 0 nothing changes but the signals', c0.mode[0] === 0 && c0.mode[1] === 0 && c0.ai.join() === '-50,-40')
const c05 = readCurve(sim, 0.05)
check('halfway to the first point is half its effect, per seed', c05.mode.join() === '-5,5', c05.mode.join())
check('a range across zero is "no effect"', noEffect(c05.mode) && !noEffect(c0.ai))
check('beyond the last point it holds the last value', readCurve(sim, 0.9).both.join() === readCurve(sim, 0.2).both.join())

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
