/**
 * Tree planting and bike-lane candidates. Run: node src/green/plan.test.mjs
 */
import { analyseGreen, isBike } from './plan.js'
import { projector } from '../transit/coverage.js'

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `   ${detail}` : ''}`)
  if (!ok) failures++
}

const centre = [42.6629, 21.1655]
const p = projector(...centre)
const g = (x, y) => { const [lat, lon] = p.ll(x, y); return { lat, lon } }
let nid = 1
const way = (id, tags, pts) => {
  const nodes = pts.map((q) => q.n ?? nid++)
  return { type: 'way', id, tags, nodes, geometry: pts.map(([x, y]) => g(x, y)) }
}
const tree = (x, y) => ({ type: 'node', id: 9000 + nid++, ...g(x, y) })

// A shaded street (tree every 20 m), a bare street, a short bare one.
const shaded = way(1, { highway: 'residential', name: 'Shaded' }, [[0, 0], [200, 0]])
const bare = way(2, { highway: 'residential', name: 'Bare' }, [[0, 100], [300, 100]])
const short = way(3, { highway: 'residential', name: 'Short' }, [[0, 200], [40, 200]])
const trees = []
for (let x = 0; x <= 200; x += 20) trees.push(tree(x, 5))

// Two separate cycleways, a plain street joining them, and an unconnected main street.
const A = 501, B = 502, C = 503, D = 504
const bikeA = { type: 'way', id: 10, tags: { highway: 'cycleway' }, nodes: [601, A], geometry: [g(0, 400), g(100, 400)] }
const bikeB = { type: 'way', id: 11, tags: { highway: 'residential', 'cycleway:right': 'lane' }, nodes: [B, 602], geometry: [g(250, 400), g(500, 400)] }
const link = { type: 'way', id: 12, tags: { highway: 'tertiary', name: 'Link' }, nodes: [A, B], geometry: [g(100, 400), g(250, 400)] }
const main = { type: 'way', id: 13, tags: { highway: 'secondary', name: 'Main' }, nodes: [C, D], geometry: [g(0, 800), g(400, 800)] }

const r = analyseGreen([shaded, bare, short, ...trees, bikeA, bikeB, link, main], centre)

check('trees are counted', r.trees.count === 11)
check('the bare street is a planting candidate, the shaded one is not',
  r.planting.some((x) => x.name === 'Bare') && !r.planting.some((x) => x.name === 'Shaded'))
check('streets under 60 m are left out', !r.planting.some((x) => x.name === 'Short'))
check('room for one tree every 10 m', r.planting.find((x) => x.name === 'Bare').room === 30)
check('a street with a cycle lane counts as bike network', isBike({ highway: 'residential', 'cycleway:right': 'lane' }))
check('two separate bike pieces', r.bike.pieces === 2, `${r.bike.pieces}`)
check('the street joining them is a connector', r.bike.connectors.length === 1 && r.bike.connectors[0].name === 'Link')
check('a connector reports the network it joins (100 m + 250 m)', Math.abs(r.bike.connectors[0].joinsKm - 0.35) < 0.06, `${r.bike.connectors[0].joinsKm} km`)
check('main streets without a lane are listed', r.bike.arterials.some((x) => x.name === 'Main'))
check('a street that has a lane is not listed as lacking one', !r.bike.arterials.some((x) => x.ways.includes('way/11')))
check('11 trees on ~1.3 km of street (8/km) reads as sparse mapping', r.trees.sparse, `${r.trees.perKm}/km`)
check('an area with no mapped trees is flagged as sparse data', analyseGreen([bare], centre).trees.sparse)

// A street running 300 m but only 100 m of it inside the box counts 100 m.
const long = way(20, { highway: 'residential', name: 'Long' }, [[0, 1000], [100, 1000], [200, 1000], [300, 1000]])
const [s0, w0] = p.ll(-50, 950), [n0, e0] = p.ll(100, 1050)
const clipped = analyseGreen([long], centre, [s0, w0, n0, e0])
const lg = clipped.planting.find((x) => x.name === 'Long')
check('a way is measured only inside the box', lg && Math.abs(lg.lengthM - 100) < 2, `${lg?.lengthM} m`)
check('and drawn only inside it', lg && lg.lines.length === 1 && lg.lines[0].length === 2)

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
