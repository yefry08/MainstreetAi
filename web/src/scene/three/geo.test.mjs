/**
 * Numeric verification of the scene projection.
 *
 * The render pane in the build environment cannot composite frames, so "does it
 * look right" is not available as a check. This is the substitute, and for a
 * coordinate transform it is a better one anyway: a screenshot would only prove
 * the cars are roughly on roads, whereas this proves the transform is correct to
 * the centimetre.
 *
 * Run:  node src/scene/three/geo.test.mjs
 */

import {
  createProjection,
  haversineMetres,
  lngLatToMercator,
  mercatorToLngLat,
} from './geo.js'

const ORIGIN = [2.1662, 41.3925] // Eixample, the scene anchor

// Real Barcelona landmarks inside the simulated extract.
const PLACES = {
  'Plaça Catalunya': [2.1700, 41.3870],
  'Sagrada Família': [2.1744, 41.4036],
  'Camp Nou': [2.1228, 41.3809],
  'Glòries (Meridiana)': [2.1866, 41.4038],
  'Plaça Espanya': [2.1490, 41.3750],
  'Diagonal / Pg. de Gràcia': [2.1618, 41.3949],
}

let failures = 0
const check = (name, ok, detail) => {
  if (!ok) failures++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '   ' + detail : ''}`)
}

console.log('\n=== 1. Mercator round-trip ===')
for (const [name, ll] of Object.entries(PLACES)) {
  const m = lngLatToMercator(ll[0], ll[1])
  const back = mercatorToLngLat(m.x, m.y)
  const errM = haversineMetres(ll, back)
  check(name.padEnd(26), errM < 0.001, `round-trip error ${(errM * 1000).toFixed(4)} mm`)
}

console.log('\n=== 2. Scene round-trip (lng/lat -> metres -> lng/lat) ===')
const proj = createProjection(ORIGIN)
for (const [name, ll] of Object.entries(PLACES)) {
  const s = proj.toScene(ll[0], ll[1])
  const back = proj.toLngLat(s.x, s.y)
  const errM = haversineMetres(ll, back)
  check(name.padEnd(26), errM < 0.001, `error ${(errM * 1000).toFixed(4)} mm`)
}

console.log('\n=== 3. Scene distances vs true great-circle distance ===')
console.log('    (Mercator distorts with latitude; near the origin the error')
console.log('     should be a small fraction of a percent.)')
const names = Object.keys(PLACES)
let worstPct = 0
for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    const a = PLACES[names[i]]
    const b = PLACES[names[j]]
    const sa = proj.toScene(a[0], a[1])
    const sb = proj.toScene(b[0], b[1])
    const sceneD = Math.hypot(sb.x - sa.x, sb.y - sa.y)
    const trueD = haversineMetres(a, b)
    const pct = Math.abs(sceneD - trueD) / trueD * 100
    if (pct > worstPct) worstPct = pct
  }
}
check(
  'all pairwise distances'.padEnd(26),
  worstPct < 0.5,
  `worst deviation ${worstPct.toFixed(4)}%`
)

console.log('\n=== 4. Orientation (signs are the classic way to get this wrong) ===')
const north = proj.toScene(ORIGIN[0], ORIGIN[1] + 0.01)
const east = proj.toScene(ORIGIN[0] + 0.01, ORIGIN[1])
check('north is +y'.padEnd(26), north.y > 0 && Math.abs(north.x) < 1e-6,
  `y=${north.y.toFixed(1)}m x=${north.x.toFixed(6)}m`)
check('east is +x'.padEnd(26), east.x > 0 && Math.abs(east.y) < 1e-6,
  `x=${east.x.toFixed(1)}m y=${east.y.toFixed(6)}m`)

console.log('\n=== 5. Origin maps to the scene origin ===')
const o = proj.toScene(ORIGIN[0], ORIGIN[1])
check('origin at (0,0)'.padEnd(26), Math.hypot(o.x, o.y) < 1e-9,
  `(${o.x.toExponential(2)}, ${o.y.toExponential(2)})`)

console.log('\n=== 6. float32 precision at scene extremes ===')
console.log('    (the reason we work in local metres rather than Mercator units)')
let worstF32 = 0
for (const ll of Object.values(PLACES)) {
  const s = proj.toScene(ll[0], ll[1])
  const err = Math.hypot(
    Math.fround(s.x) - s.x,
    Math.fround(s.y) - s.y
  )
  if (err > worstF32) worstF32 = err
}
check('float32 error < 1 mm'.padEnd(26), worstF32 < 0.001,
  `worst ${(worstF32 * 1000).toFixed(4)} mm`)

// For contrast: what it would have been in raw Mercator units.
const mm = lngLatToMercator(PLACES['Camp Nou'][0], PLACES['Camp Nou'][1])
const f32MercErr =
  Math.hypot(Math.fround(mm.x) - mm.x, Math.fround(mm.y) - mm.y) *
  (40075016.686 * Math.cos((41.39 * Math.PI) / 180))
console.log(
  `       (raw Mercator in float32 would be off by ${f32MercErr.toFixed(2)} m ` +
  `— roughly a bus length of jitter)`
)

console.log(
  `\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing check(s)\n`
)
process.exit(failures === 0 ? 0 : 1)
