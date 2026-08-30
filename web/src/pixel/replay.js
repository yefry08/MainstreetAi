/**
 * Replay decoder: turns the recorded binary back into wire-shaped frames.
 *
 * The renderer already knows how to draw a frame of six float32s per vehicle,
 * so the cheapest correct thing is to hand it exactly that and let it stay
 * ignorant of where the frame came from. A replay frame and a live frame are
 * indistinguishable downstream, which means the replay exercises the same code
 * path the live demo does rather than a parallel one that could rot.
 *
 * The recording quantises against the known extent (see sim/record_replay.py):
 *
 *     lon, lat   uint16 across the extent  -> ~0.13 m, far under one pixel
 *     angle      uint8, 1.4 deg            -> under the 5.6 deg the sprite
 *                                             sheet already rounds to
 *     kind       uint8
 *     speed      uint8, 0.25 m/s steps
 *     turn       int8, 1 deg steps
 *
 * Eight bytes a vehicle against the wire's twenty-four.
 */

const STRIDE_IN = 8       // bytes per vehicle in the recording
const STRIDE_OUT = 6      // float32s per vehicle the renderer expects

export function createReplay(manifest, buffers) {
  const [W, S, E, N] = manifest.extent
  const maxSpeed = manifest.max_speed ?? 63
  const spanLon = E - W
  const spanLat = N - S

  const twins = {}
  for (const mode of Object.keys(manifest.twins)) {
    const counts = manifest.frame_counts[mode]
    const veh = new Uint8Array(buffers[`${mode}.veh`])
    const sig = new Uint8Array(buffers[`${mode}.sig`])
    const nSig = manifest.twins[mode].n_sig
    const sigBytes = Math.ceil(nSig / 4)

    // Byte offset of each frame, precomputed: frames vary in length because
    // the vehicle count changes, so they cannot be indexed by multiplication.
    const vehOff = new Uint32Array(counts.length + 1)
    for (let i = 0; i < counts.length; i++) {
      vehOff[i + 1] = vehOff[i] + counts[i] * STRIDE_IN
    }
    twins[mode] = { counts, veh, sig, nSig, sigBytes, vehOff }
  }

  // Reused across frames: at ~5,000 vehicles and 4 Hz, allocating a fresh
  // Float32Array per frame would churn 120 KB a second for no reason.
  let scratch = new Float32Array(0)
  let sigScratch = new Uint8Array(0)

  const frameCount = (mode) => twins[mode]?.counts.length ?? 0

  /** Decode one frame into the shape the renderer already consumes. */
  function frame(mode, index) {
    const t = twins[mode]
    if (!t) return null
    const i = ((index % t.counts.length) + t.counts.length) % t.counts.length
    const n = t.counts[i]

    if (scratch.length < n * STRIDE_OUT) scratch = new Float32Array(n * STRIDE_OUT)
    const off = t.vehOff[i]

    for (let v = 0; v < n; v++) {
      const b = off + v * STRIDE_IN
      const o = v * STRIDE_OUT
      const lonQ = t.veh[b] | (t.veh[b + 1] << 8)
      const latQ = t.veh[b + 2] | (t.veh[b + 3] << 8)
      scratch[o] = W + (lonQ / 65535) * spanLon
      scratch[o + 1] = S + (latQ / 65535) * spanLat
      scratch[o + 2] = (t.veh[b + 4] / 255) * 360
      scratch[o + 3] = t.veh[b + 5]
      scratch[o + 4] = (t.veh[b + 6] / 255) * maxSpeed
      // int8: values above 127 are negative turns
      const turn = t.veh[b + 7]
      scratch[o + 5] = turn > 127 ? turn - 256 : turn
    }

    // Unpack two-bit signal states.
    if (sigScratch.length < t.nSig) sigScratch = new Uint8Array(t.nSig)
    const sOff = i * t.sigBytes
    for (let k = 0; k < t.nSig; k++) {
      const byte = t.sig[sOff + (k >> 2)]
      sigScratch[k] = (byte >> ((k & 3) * 2)) & 3
    }

    return {
      header: { sim_time: i, n_veh: n, focus: mode },
      // The renderer reads `vehicles` as a flat array of STRIDE_OUT floats.
      vehicles: scratch.subarray(0, n * STRIDE_OUT),
      signals: sigScratch.subarray(0, t.nSig),
    }
  }

  return {
    frame,
    frameCount,
    modes: Object.keys(twins),
    hz: manifest.hz ?? 4,
    stats: manifest.stats ?? null,
    recordedAt: manifest.recorded_at ?? null,
  }
}

/** Fetch the manifest and every binary it names. */
export async function loadReplay(base = '/replay') {
  const manifest = await (await fetch(`${base}/manifest.json`)).json()
  const buffers = {}
  await Promise.all(
    Object.keys(manifest.twins).flatMap((mode) => ([
      fetch(`${base}/${mode}.veh.bin`).then(async (r) => {
        buffers[`${mode}.veh`] = await r.arrayBuffer()
      }),
      fetch(`${base}/${mode}.sig.bin`).then(async (r) => {
        buffers[`${mode}.sig`] = await r.arrayBuffer()
      }),
    ])),
  )
  return createReplay(manifest, buffers)
}
