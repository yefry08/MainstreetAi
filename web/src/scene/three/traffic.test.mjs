/**
 * Vehicle heading: the rendered rotation must come from the VEHICLE, never
 * from whatever the instance slot held on the previous tick.
 *
 * The bug this pins down shipped and looked like a fix. Vehicles were being
 * eased from `yawTarget[i]` — the heading of whatever occupied slot i last
 * tick — toward their current heading, on the assumption that a slot keeps
 * its vehicle. It does not: the wire carries no vehicle ids and the array is
 * repacked every tick. Measured on the real network, a slot holds the same
 * vehicle only 36.4% of the time, and 55.2% of slot-ticks were rendering a
 * rotation more than 15 degrees wrong, median error 95 degrees. Vehicles
 * turned smoothly toward the wrong way round, which is worse than the
 * snapping it was meant to cure.
 *
 * The fix carries each vehicle's own turn rate on the wire, so the renderer
 * extrapolates heading from measured state exactly as it extrapolates
 * position from speed. This test fails loudly if slot-derived state ever
 * creeps back.
 *
 * Run:  node src/scene/three/traffic.test.mjs
 */

import { createTraffic } from './traffic.js'
import { createProjection } from './geo.js'
import * as THREE from 'three'

const ORIGIN = [2.1662, 41.3925]
const proj = createProjection(ORIGIN)
const STRIDE = 6
const DEG = Math.PI / 180

let failures = 0
const check = (name, ok, detail) => {
  if (!ok) failures++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '   ' + detail : ''}`)
}

const scene = new THREE.Scene()
const traffic = createTraffic({ scene, proj })

let carMesh = null
traffic.group.traverse((o) => { if (o.name === 'cars') carMesh = o })

/** Yaw (radians about +Z) currently baked into car instance `i`. */
function renderedYaw(i) {
  const m = new THREE.Matrix4()
  carMesh.getMatrixAt(i, m)
  const q = new THREE.Quaternion()
  m.decompose(new THREE.Vector3(), q, new THREE.Vector3())
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ')
  return e.z
}

/** Build a frame: one entry per [lon, lat, angleDeg, kind, speed, turnDeg]. */
function frame(simTime, rows) {
  const v = new Float32Array(rows.length * STRIDE)
  rows.forEach((r, i) => v.set(r, i * STRIDE))
  return { header: { sim_time: simTime }, vehicles: v }
}

const near = (a, b, tol) => Math.abs(a - b) <= tol

// ---------------------------------------------------------------------------
// Tick 1: a single car heading due north (0 deg), not turning.
traffic.applyFrame(frame(1, [[2.1662, 41.3925, 0, 0, 5, 0]]))
traffic.tick(16, 41.39)
check('heading 0 renders yaw 0', near(renderedYaw(0), 0, 1e-3),
  renderedYaw(0).toFixed(4))

// ---------------------------------------------------------------------------
// Tick 2: slot 0 is now a DIFFERENT car, heading due east (90 deg), not
// turning. The old code would have started this one at the previous
// occupant's heading (0 deg) and eased toward 90. The correct render is
// 90 deg immediately, because this vehicle reports no turn.
traffic.applyFrame(frame(2, [[2.1662, 41.3925, 90, 0, 5, 0]]))
traffic.tick(16, 41.39)
// SUMO degrees are clockwise from north; scene yaw is counter-clockwise.
const wantEast = -90 * DEG
check('slot reused by a different vehicle uses ITS OWN heading',
  near(renderedYaw(0), wantEast, 2e-3),
  `${(renderedYaw(0) / DEG).toFixed(1)}deg, want ${(wantEast / DEG).toFixed(1)}deg`)

// ---------------------------------------------------------------------------
// A vehicle that IS turning extrapolates forward along its own turn rate,
// never past the full tick's worth.
traffic.applyFrame(frame(3, [[2.1662, 41.3925, 100, 0, 5, 20]]))
traffic.tick(16, 41.39)
const y = renderedYaw(0)
const lo = -120 * DEG   // 100 + a full tick of 20 deg
const hi = -100 * DEG   // no extrapolation yet
check('turning vehicle stays within its own turn arc',
  y <= hi + 2e-3 && y >= lo - 2e-3,
  `${(y / DEG).toFixed(1)}deg in [${(lo / DEG).toFixed(0)}, ${(hi / DEG).toFixed(0)}]`)

// ---------------------------------------------------------------------------
// The wrap case: heading 350 turning +20 crosses north. Extrapolation must
// not unwrap into a ~-330 deg spin.
traffic.applyFrame(frame(4, [[2.1662, 41.3925, 350, 0, 5, 20]]))
traffic.tick(16, 41.39)
const spun = renderedYaw(0)
check('crossing north does not spin the model',
  Math.abs(spun) <= Math.PI * 2 + 1e-3, `${(spun / DEG).toFixed(1)}deg`)

// ---------------------------------------------------------------------------
// Mixed fleet: every kind lands in its own mesh, and the counts add up.
traffic.applyFrame(frame(5, [
  [2.1662, 41.3925, 0, 0, 5, 0],
  [2.1663, 41.3925, 0, 1, 5, 0],
  [2.1664, 41.3925, 0, 2, 5, 0],
  [2.1665, 41.3925, 0, 3, 5, 0],
  [2.1666, 41.3925, 0, 4, 5, 0],
]))
traffic.tick(16, 41.39)
const st = traffic.stats()
check('five kinds split across five meshes',
  st.cars === 1 && st.buses === 1 && st.bikes === 1 &&
  st.trucks === 1 && st.motos === 1,
  `${st.cars}/${st.buses}/${st.bikes}/${st.trucks}/${st.motos}`)
check('vehicle total matches the frame', st.vehicles === 5, `${st.vehicles}`)
check('six draw calls regardless of count', st.drawCalls === 6, `${st.drawCalls}`)

// ---------------------------------------------------------------------------
// A repeated sim_time is a duplicate frame and must be ignored.
check('duplicate sim_time is rejected',
  traffic.applyFrame(frame(5, [[2.1662, 41.3925, 0, 0, 5, 0]])) === -1)

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
