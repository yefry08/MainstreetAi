/**
 * Route-review flags. Run: node src/transit/coverage.test.mjs
 */
import { coverageGaps, projector } from './coverage.js'

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `   ${detail}` : ''}`)
  if (!ok) failures++
}

const centre = [42.6629, 21.1655]
const p = projector(...centre)
const at = (x, y) => { const [lat, lon] = p.ll(x, y); return { lat, lon } }
check('projection round-trips to the centimetre', (() => {
  const { lat, lon } = at(1234, -567); const [x, y] = p.xy(lat, lon)
  return Math.abs(x - 1234) < 0.01 && Math.abs(y + 567) < 0.01
})())

// A stop at the origin; 40 homes beside it, and a 30-home block ~1.5 km east,
// placed inside one 250 m cell (1520-1595 m) rather than on a cell edge.
const stops = [{ id: 'node/1', name: 'Centre', ...at(0, 0) }]
const homes = []
for (let i = 0; i < 40; i++) homes.push({ id: `way/${i}`, ...at((i % 8) * 20, Math.floor(i / 8) * 20) })
for (let i = 0; i < 30; i++) homes.push({ id: `way/${100 + i}`, ...at(1520 + (i % 6) * 15, 10 + Math.floor(i / 6) * 15) })
// Five stray houses far north: too few to be a neighbourhood.
for (let i = 0; i < 5; i++) homes.push({ id: `way/${200 + i}`, ...at(0, 2000 + i * 10) })

const r = coverageGaps({ homes, stops, centre })
check('homes beside a stop are covered', r.totals.covered === 40)
check('the far block is one flag', r.cells.length === 1 && r.cells[0].homes === 30, JSON.stringify(r.cells.map((c) => c.homes)))
check('its distance is to the nearest stop', Math.abs(r.cells[0].nearestM - 1520) < 15, `${r.cells[0].nearestM} m`)
check('a flag names its stop and keeps home ids as evidence',
  r.cells[0].nearestStop.id === 'node/1' && r.cells[0].homeIds.length === 5 && r.cells[0].homeIds[0] === 'way/100')
check('a few stray houses are not a flag', !r.cells.some((c) => c.homes === 5))
check('covered share', Math.abs(r.totals.coveredShare - 40 / 75) < 1e-9)

const none = coverageGaps({ homes, stops: [], centre })
check('no stops at all: everything is a gap, distance unknown', none.totals.covered === 0 && none.cells.every((c) => c.nearestM === null))

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
