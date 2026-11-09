/**
 * Canopy targets and tree counts. Run: node src/green/canopy.test.mjs
 */
import { CROWN_M2, STREET_FEASIBLE, TARGET, benefits, cellPlan, districtDeficit, pixelArea, treesFromCanopy } from './canopy.js'

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `   ${detail}` : ''}`)
  if (!ok) failures++
}

const P = pixelArea(18.475)
check('a WorldCover pixel at 18.5 N is ~81 m2, not 100', Math.abs(P - 81) < 0.5, `${P.toFixed(1)} m2`)
check('…and ~85 m2 at the equator', Math.abs(pixelArea(0) - 85.5) < 0.5)

// 625 pixels: 5% trees, 80% built, 15% grass; 1.2 km of street.
const px = { tree: 31, shrub: 0, grass: 94, bare: 0, built: 500, water: 0 }
const c = cellPlan(px, 1200, P)
check('canopy share measured', Math.abs(c.canopy - 31 / 625) < 1e-9, `${(c.canopy * 100).toFixed(1)}%`)
check('deficit uses the real pixel area', Math.abs(c.deficitM2 - (TARGET * 625 - 31) * P) < 1e-6, `${Math.round(c.deficitM2)} m2`)
check('missing = deficit / crown', c.missing === Math.round(c.deficitM2 / CROWN_M2), `${c.missing} trees`)
const streetRoom = Math.floor(((1200 * STREET_FEASIBLE) / 10) * (1 - 31 / 625))
check('street room: feasible share, less what canopy already covers', c.onStreets <= streetRoom && streetRoom === 57, `${streetRoom}`)
check('plant is limited by room', c.plant === Math.min(c.missing, c.room))
check('a leafy cell needs nothing', cellPlan({ tree: 300, shrub: 0, grass: 100, bare: 0, built: 225, water: 0 }, 800, P).missing === 0)
check('a cell of sea is skipped', cellPlan({ tree: 0, shrub: 0, grass: 0, bare: 0, built: 5, water: 620 }, 0, P) === null)
check('built-up cells rank above green ones', c.priority > cellPlan({ tree: 31, shrub: 0, grass: 494, bare: 0, built: 100, water: 0 }, 1200, P).priority)

// The district deficit is smaller than the per-cell sum when some cells are leafy.
const lean = { tree: 0, land: 625 }, leafy = { tree: 400, land: 625 }
const perCell = Math.round(((TARGET * 625 - 0) * P) / CROWN_M2)        // the leafy cell adds nothing
const whole = districtDeficit(lean.tree + leafy.tree, lean.land + leafy.land, P)
check('district deficit < sum of cell deficits when leafy cells offset', whole < perCell, `${whole} vs ${perCell}`)

const b = benefits(1000, 10)
check('1,000 mature trees: 15-40 t CO2 a year', b.co2TYr[0] === 15 && b.co2TYr[1] === 25 && b.co2TYr[2] === 40)
check('+10 canopy points: 0.3-1 C', b.coolingC[0] === 0.3 && b.coolingC[2] === 1)
check('trees standing use the real pixel area', treesFromCanopy(500, P) === Math.round((500 * P) / 50))

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
