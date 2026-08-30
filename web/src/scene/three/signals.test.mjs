/**
 * Signal repaint correctness.
 *
 * The bug this pins down: the old code decided whether to repaint by sampling
 * FOUR indices of the state array (0, n/3, n/2, n-1) plus its length, and
 * skipped the repaint when that sample matched the previous tick. Measured
 * against the real network over 340 simulated seconds, that discarded 81% of
 * genuine state changes -- 219 of 270 -- leaving stale signal colours on the
 * map with no error and no warning.
 *
 * It is the same shape of failure as the ribbon winding bug: invisible in a
 * screenshot taken at the wrong moment, trivially provable in a test. So the
 * invariant is stated directly -- a change anywhere in the array must repaint
 * exactly the lamps that changed, and nothing else.
 *
 * Run:  node src/scene/three/signals.test.mjs
 */

import { createSignals } from './signals.js'
import { createProjection } from './geo.js'
import * as THREE from 'three'

const ORIGIN = [2.1662, 41.3925]
const proj = createProjection(ORIGIN)

let failures = 0
const check = (name, ok, detail) => {
  if (!ok) failures++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '   ' + detail : ''}`)
}

const N = 400
const scene = new THREE.Scene()
const signals = Array.from({ length: N }, (_, i) => ({
  pos: [2.1662 + (i % 20) * 0.0004, 41.3925 + Math.floor(i / 20) * 0.0004],
  id: `j${i}`,
}))

const sig = createSignals({ scene, proj, signals })
const ZOOM = 15

console.log(`signals: ${N} lamps`)

// ---- first paint --------------------------------------------------------
const state = new Uint8Array(N) // all red
let r = sig.update(state, ZOOM)
check('first paint touches every lamp', r.repainted === N, `${r.repainted}/${N}`)

// ---- no change ----------------------------------------------------------
r = sig.update(state, ZOOM)
check('unchanged state repaints nothing', r.repainted === 0, `${r.repainted}`)

// ---- the exact case the sampled key missed ------------------------------
// Change a lamp that is NOT one of the four sampled indices (0, n/3, n/2,
// n-1). The old key was blind to this; it must repaint exactly one lamp.
const sampled = new Set([0, (N / 3) | 0, (N / 2) | 0, N - 1])
let victim = -1
for (let i = 0; i < N; i++) {
  if (!sampled.has(i)) { victim = i; break }
}
state[victim] = 2
r = sig.update(state, ZOOM)
check('change at an unsampled index is caught', r.repainted === 1,
  `index ${victim}, repainted ${r.repainted}`)

// ---- a change at EVERY unsampled index ----------------------------------
// The strongest form: if any single unsampled lamp could be missed, this
// catches it. Flip them one at a time and require a repaint each time.
let missed = 0
for (let i = 0; i < N; i++) {
  if (sampled.has(i)) continue
  state[i] = state[i] === 2 ? 0 : 2
  if (sig.update(state, ZOOM).repainted !== 1) missed++
}
check('no single-lamp change is ever missed', missed === 0, `${missed} missed`)

// ---- bulk change --------------------------------------------------------
const bulk = new Uint8Array(N)
for (let i = 0; i < N; i++) bulk[i] = i % 3
const before = sig.stats()
r = sig.update(bulk, ZOOM)
let expected = 0
for (let i = 0; i < N; i++) if (bulk[i] !== state[i]) expected++
check('bulk change repaints exactly the differing lamps',
  r.repainted === expected, `${r.repainted} vs ${expected}`)

// ---- stats reflect what is on screen ------------------------------------
const s = sig.stats()
const want = { red: 0, amber: 0, green: 0 }
for (let i = 0; i < N; i++) {
  if (bulk[i] === 2) want.green++
  else if (bulk[i] === 1) want.amber++
  else want.red++
}
check('stats colour mix matches the painted state',
  s.red === want.red && s.amber === want.amber && s.green === want.green,
  `${s.red}/${s.amber}/${s.green} vs ${want.red}/${want.amber}/${want.green}`)
check('still three draw calls', s.drawCalls === 3, `${s.drawCalls}`)

// ---- short array is ignored rather than crashing ------------------------
r = sig.update(new Uint8Array(N - 5), ZOOM)
check('undersized state array is ignored', r.repainted === 0, `${r.repainted}`)

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
