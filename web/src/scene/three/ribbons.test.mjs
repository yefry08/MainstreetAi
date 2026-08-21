/**
 * Ribbon geometry invariants.
 *
 * The one that matters most is WINDING. The ribbon material uses
 * THREE.FrontSide (half the draw cost of DoubleSide for a transparent
 * material, which three renders in two passes). That is only safe if every
 * triangle is counter-clockwise when viewed from above, because the map camera
 * can never get below the ground plane.
 *
 * Get it backwards and the entire road network silently disappears — no error,
 * no warning, just an empty city. Exactly the class of bug a screenshot would
 * catch and a unit test catches better.
 *
 * Run:  node src/scene/three/ribbons.test.mjs
 */

import { buildRibbons } from './ribbons.js'
import { createProjection } from './geo.js'

const ORIGIN = [2.1662, 41.3925]
const proj = createProjection(ORIGIN)

let failures = 0
const check = (name, ok, detail) => {
  if (!ok) failures++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '   ' + detail : ''}`)
}

// A short east-west street and a short north-south one, plus a bend.
const features = [
  { path: [[2.1662, 41.3925], [2.1682, 41.3925]], tier: 'arterial', w: 4 },
  { path: [[2.1662, 41.3925], [2.1662, 41.3945]], tier: 'local', w: 2 },
  { path: [[2.1650, 41.3910], [2.1662, 41.3925], [2.1680, 41.3930]], tier: 'distributor', w: 3 },
]

const { geometry, ranges, segCount, vertexCount } = buildRibbons(features, proj, {
  width: 8,
  z: 0.5,
})

console.log('\n=== structure ===')
check('segment count', segCount === 4, `${segCount} (expected 4)`)
check('vertex count', vertexCount === segCount * 4, `${vertexCount}`)
check(
  'index count',
  geometry.getIndex().count === segCount * 6,
  `${geometry.getIndex().count}`
)
check(
  'colour attribute is vec4',
  geometry.getAttribute('color').itemSize === 4,
  `itemSize ${geometry.getAttribute('color').itemSize}`
)

console.log('\n=== per-feature ranges (needed for per-edge recolouring) ===')
let rangeOk = true
let covered = 0
for (let i = 0; i < features.length; i++) {
  const start = ranges[i * 2]
  const count = ranges[i * 2 + 1]
  const expect = (features[i].path.length - 1) * 4
  if (count !== expect || start !== covered) rangeOk = false
  covered += count
}
check('ranges contiguous and correct', rangeOk && covered === vertexCount,
  `covered ${covered}/${vertexCount}`)

console.log('\n=== WINDING: every triangle CCW seen from above ===')
const pos = geometry.getAttribute('position').array
const idx = geometry.getIndex().array
let ccw = 0
let cw = 0
let degenerate = 0
for (let t = 0; t < idx.length; t += 3) {
  const a = idx[t] * 3
  const b = idx[t + 1] * 3
  const c = idx[t + 2] * 3
  // z-component of (B-A) x (C-A); positive == counter-clockwise from +z
  const cross =
    (pos[b] - pos[a]) * (pos[c + 1] - pos[a + 1]) -
    (pos[b + 1] - pos[a + 1]) * (pos[c] - pos[a])
  if (Math.abs(cross) < 1e-9) degenerate++
  else if (cross > 0) ccw++
  else cw++
}
check(
  'all triangles front-facing',
  cw === 0 && degenerate === 0,
  `${ccw} ccw, ${cw} cw, ${degenerate} degenerate`
)

console.log('\n=== ribbon width is honoured in metres ===')
// Feature 0 runs due east; its quad should be `width` metres tall in y.
const w0 = Math.abs(pos[0 * 3 + 1] - pos[1 * 3 + 1])
check('east-west street width', Math.abs(w0 - 8) < 1e-3, `${w0.toFixed(4)} m (expected 8)`)

// Feature 1 runs due north; its quad should be `width` metres wide in x.
const s1 = ranges[2]
const w1 = Math.abs(pos[s1 * 3] - pos[(s1 + 1) * 3])
check('north-south street width', Math.abs(w1 - 8) < 1e-3, `${w1.toFixed(4)} m (expected 8)`)

console.log('\n=== flat on the ground plane ===')
let flat = true
for (let i = 2; i < pos.length; i += 3) if (Math.abs(pos[i] - 0.5) > 1e-6) flat = false
check('all vertices at z = 0.5 m', flat)

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing check(s)\n`)
process.exit(failures === 0 ? 0 : 1)
