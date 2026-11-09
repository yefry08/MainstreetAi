/**
 * Canopy targets and tree counts. Run: node src/green/canopy.test.mjs
 */
import { CROWN_M2, PIXEL_M2, TARGET, benefits, cellPlan, treesFromCanopy } from './canopy.js'

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `   ${detail}` : ''}`)
  if (!ok) failures++
}

// A 250 m cell = 625 pixels. 5% trees, 80% built, 15% grass; 1.2 km of street.
const px = { tree: 31, shrub: 0, grass: 94, bare: 0, built: 500, water: 0 }
const c = cellPlan(px, 1200)
check('canopy share measured', Math.abs(c.canopy - 31 / 625) < 1e-9, `${(c.canopy * 100).toFixed(1)}%`)
check('deficit to 30% in m2', c.deficitM2 === (TARGET * 625 - 31) * PIXEL_M2, `${c.deficitM2} m2`)
check('missing = deficit / crown', c.missing === Math.round(c.deficitM2 / CROWN_M2), `${c.missing} trees`)
check('room = street trees + open ground', c.room === 120 + Math.floor((94 * 100 * 0.25) / 50), `${c.room}`)
check('plant is limited by room', c.plant === Math.min(c.missing, c.room))
check('street trees come first', c.onStreets === Math.min(c.plant, 120) && c.onOpen === c.plant - c.onStreets)
check('canopy rises by the planted crowns', Math.abs(c.canopyAfter - (c.canopy + (c.plant * 50) / 62500)) < 1e-9,
  `${(c.canopy * 100).toFixed(0)}% -> ${(c.canopyAfter * 100).toFixed(0)}%`)
check('a leafy cell needs nothing', cellPlan({ tree: 300, shrub: 0, grass: 100, bare: 0, built: 225, water: 0 }, 800).missing === 0)
check('a cell of sea is skipped', cellPlan({ tree: 0, shrub: 0, grass: 0, bare: 0, built: 5, water: 620 }, 0) === null)
check('built-up cells rank above green ones', c.priority > cellPlan({ tree: 31, shrub: 0, grass: 494, bare: 0, built: 100, water: 0 }, 1200).priority)

const b = benefits(1000, 10)
check('1,000 trees: ~25 t CO2 a year (15-40)', b.co2TYr[1] === 25 && b.co2TYr[0] === 15 && b.co2TYr[2] === 40)
check('…3,800 m3 of rain', b.waterM3Yr === 3800)
check('+10 canopy points: ~0.5 C (0.3-1)', b.coolingC[1] === 0.5)
check('trees standing from canopy area', treesFromCanopy(500) === 1000)

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
