/**
 * Unit tests for the replay decoder.
 *
 * This is the module with the least visible failure mode in the project. It
 * turns 8 quantised bytes per vehicle back into the 6 float32s the renderer
 * expects, and every bug in it produces vehicles that are still drawn, still
 * moving, and simply in the wrong place or facing the wrong way. Nothing
 * throws. The demo looks fine and is wrong.
 *
 * So the tests are built by ENCODING known values with the recorder's own
 * arithmetic and asserting they survive the round trip, rather than by
 * asserting against numbers copied out of the implementation.
 *
 * Three of these pin faults this format is specifically prone to:
 *   - the turn byte is int8 in a Uint8Array, so >127 must read as negative;
 *   - signal states are two bits each, four to a byte, little end first;
 *   - frames vary in length, so they are indexed by a prefix-sum table and
 *     cannot be found by multiplication.
 */

import { createReplay } from './replay.js'

let failures = 0
const check = (name, ok, detail) => {
  if (!ok) failures++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '   ' + detail : ''}`)
}
const near = (a, b, tol) => Math.abs(a - b) <= tol

// Frames are Float32Array, which carries ~7 significant digits. At latitude
// 41.42 the nearest float32 is 41.41999816894531 -- an error of 1.8e-6 that no
// decoder change can remove. Tolerances below are sized for that, and
// tightening them past it asserts against the storage type, not the code.
const F32 = 1e-5

// The extent the recorder quantises against: [W, S, E, N].
const EXTENT = [2.10, 41.36, 2.22, 41.42]
const [W, S, E, N] = EXTENT
const SPAN_LON = E - W
const SPAN_LAT = N - S
const MAX_SPEED = 63

/** Encode exactly as sim/record_replay.py does, so the test is a round trip. */
function encodeVehicle({ lon, lat, angle, kind, speed, turn }) {
  const lonQ = Math.round(((lon - W) / SPAN_LON) * 65535)
  const latQ = Math.round(((lat - S) / SPAN_LAT) * 65535)
  return [
    lonQ & 0xff, (lonQ >> 8) & 0xff,
    latQ & 0xff, (latQ >> 8) & 0xff,
    Math.round((angle / 360) * 255),
    kind,
    Math.round((speed / MAX_SPEED) * 255),
    turn < 0 ? turn + 256 : turn,
  ]
}

/** Pack signal states two bits at a time, four per byte. */
function encodeSignals(states) {
  const bytes = new Uint8Array(Math.ceil(states.length / 4))
  states.forEach((s, k) => { bytes[k >> 2] |= (s & 3) << ((k & 3) * 2) })
  return bytes
}

function build(frames, nSig = 8) {
  const veh = []
  const counts = []
  const sig = []
  for (const f of frames) {
    counts.push(f.vehicles.length)
    for (const v of f.vehicles) veh.push(...encodeVehicle(v))
    sig.push(...encodeSignals(f.signals ?? new Array(nSig).fill(0)))
  }
  const manifest = {
    extent: EXTENT,
    hz: 4,
    max_speed: MAX_SPEED,
    twins: { ai: { n_sig: nSig } },
    frame_counts: { ai: counts },
    stats: {},
  }
  return createReplay(manifest, {
    'ai.veh': new Uint8Array(veh).buffer,
    'ai.sig': new Uint8Array(sig).buffer,
  })
}

console.log('replay decoder: the round trip, and the three easy ways to get it wrong')

// --- position round trip ---------------------------------------------------
{
  const want = { lon: 2.1662, lat: 41.3925, angle: 90, kind: 0, speed: 12, turn: 0 }
  const r = build([{ vehicles: [want] }])
  const f = r.frame('ai', 0)
  // 16 bits across the extent is ~0.13 m; well inside a tenth of that in degrees.
  check('longitude survives quantisation', near(f.vehicles[0], want.lon, 1e-5),
        `${f.vehicles[0]} vs ${want.lon}`)
  check('latitude survives quantisation', near(f.vehicles[1], want.lat, 1e-5),
        `${f.vehicles[1]} vs ${want.lat}`)
  check('angle survives quantisation', near(f.vehicles[2], want.angle, 1.5),
        `${f.vehicles[2]}`)
  check('kind is carried exactly', f.vehicles[3] === 0)
  check('speed survives quantisation', near(f.vehicles[4], want.speed, 0.3),
        `${f.vehicles[4]}`)
}

// --- extent corners: the quantiser must not drift off the ends -------------
{
  const r = build([{ vehicles: [
    { lon: W, lat: S, angle: 0, kind: 0, speed: 0, turn: 0 },
    { lon: E, lat: N, angle: 0, kind: 0, speed: 0, turn: 0 },
  ] }])
  const f = r.frame('ai', 0)
  check('south-west corner maps to the extent origin',
        near(f.vehicles[0], W, F32) && near(f.vehicles[1], S, F32))
  check('north-east corner maps to the extent limit',
        near(f.vehicles[6], E, F32) && near(f.vehicles[7], N, F32),
        `${f.vehicles[6]}, ${f.vehicles[7]}`)
}

// --- THE SIGN BUG: turn is int8 living in a Uint8Array ---------------------
{
  const cases = [0, 1, 45, 127, -1, -45, -128]
  const r = build([{ vehicles: cases.map((turn) => (
    { lon: 2.15, lat: 41.39, angle: 0, kind: 0, speed: 0, turn })) }])
  const f = r.frame('ai', 0)
  cases.forEach((want, i) => {
    const got = f.vehicles[i * 6 + 5]
    check(`turn ${want} decodes as ${want}`, got === want, `got ${got}`)
  })
  check('a negative turn is negative, not 200-odd',
        f.vehicles[4 * 6 + 5] < 0,
        'the whole point: >127 must read as a left turn, not a hard right')
}

// --- THE PACKING BUG: two bits per signal, four per byte -------------------
{
  const states = [0, 1, 2, 3, 3, 2, 1, 0]
  const r = build([{ vehicles: [], signals: states }], states.length)
  const f = r.frame('ai', 0)
  const got = Array.from(f.signals.slice(0, states.length))
  check('signal states unpack in order', got.join(',') === states.join(','),
        `got ${got.join(',')}`)
  check('the second nibble-pair is not the first',
        got[4] === 3 && got[0] === 0,
        'a wrong shift makes every signal read as its neighbour')
}

// --- THE INDEXING BUG: frames vary in length ------------------------------
{
  const mk = (n, lon) => ({ vehicles: Array.from({ length: n }, () => (
    { lon, lat: 41.39, angle: 0, kind: 0, speed: 0, turn: 0 })) })
  const r = build([mk(1, 2.11), mk(3, 2.15), mk(2, 2.19)])
  check('frame 0 has 1 vehicle', r.frame('ai', 0).header.n_veh === 1)
  check('frame 1 has 3 vehicles', r.frame('ai', 1).header.n_veh === 3)
  check('frame 2 has 2 vehicles', r.frame('ai', 2).header.n_veh === 2)
  check('frame 1 reads its OWN bytes, not frame 0 stride x 1',
        near(r.frame('ai', 1).vehicles[0], 2.15, 1e-4),
        `${r.frame('ai', 1).vehicles[0]} -- a fixed stride would land here on 2.11`)
  check('frame 2 reads its own bytes',
        near(r.frame('ai', 2).vehicles[0], 2.19, 1e-4))
}

// --- looping and out-of-range indices --------------------------------------
{
  const mk = (lon) => ({ vehicles: [{ lon, lat: 41.39, angle: 0, kind: 0, speed: 0, turn: 0 }] })
  const r = build([mk(2.11), mk(2.15), mk(2.19)])
  check('index wraps forward', near(r.frame('ai', 3).vehicles[0], 2.11, 1e-4))
  check('index wraps a long way forward', near(r.frame('ai', 301).vehicles[0], 2.15, 1e-4))
  check('a negative index wraps rather than reading backwards off the buffer',
        near(r.frame('ai', -1).vehicles[0], 2.19, 1e-4),
        'JS % keeps the sign, so this needs the double-modulo')
  check('frameCount reports the recorded length', r.frameCount('ai') === 3)
}

// --- an absent twin degrades, it does not throw ---------------------------
{
  const r = build([{ vehicles: [] }])
  check('an unloaded twin returns null rather than throwing',
        r.frame('baseline', 0) === null,
        'every caller guards on null; throwing here would stop the scene')
  check('frameCount of an absent twin is 0', r.frameCount('baseline') === 0)
  check('has() reports what is loaded', r.has('ai') === true && r.has('baseline') === false)
}

console.log(`\n${failures === 0 ? 'all passed' : `${failures} FAILED`}`)
process.exit(failures ? 1 : 0)
