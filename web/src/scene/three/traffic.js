import {
  Color, Group, InstancedMesh, Matrix4, Quaternion, Vector3,
} from 'three'
import {
  bikeGeometry,
  busGeometry,
  busWindowGeometry,
  carGeometry,
  glowMaterial,
  motoGeometry,
  truckGeometry,
  vehicleMaterial,
  // Extension included deliberately: Vite resolves the bare specifier, plain
  // Node ESM does not, and the tests run under node.
} from './vehicleMeshes.js'

// From design/tokens.css. Cars are a dim steel mass; buses glow from within,
// because transit priority is the argument and the mode carrying eighty people
// should be the brightest thing on the street. Motorcycles get a warm sand
// tone — they are a third of Barcelona's fleet and need to be distinguishable
// from cars at a glance without competing with the buses.
const COLOR = {
  car: 0x7e8ca3,
  bus: 0xffe3b0,
  bike: 0x4fd8e8,
  truck: 0xb8c0cc,
  moto: 0xd9c48a,
  stopped: 0xe0414f,
}

// Fixed wire encoding — the server sends these as numbers.
const KIND_CAR = 0
const KIND_BUS = 1
const KIND_BIKE = 2
const KIND_TRUCK = 3
const KIND_MOTO = 4

// Generous headroom; peak observed load is ~2,300 vehicles across all modes.
const CAPACITY = { car: 4200, bus: 700, bike: 1600, truck: 900, moto: 2600 }

// Float32s per vehicle on the wire: lon, lat, angle, kind, speed, turn-rate.
// Keep in step with sim_worker.py's veh array — a mismatch shears the whole
// fleet across the map rather than failing outright.
const STRIDE = 6

/** Below this (m/s) a vehicle is queued, and turns red. */
const STOPPED_MS = 0.6

/**
 * THE VISIBILITY PROBLEM, and why vehicles are not drawn life-sized.
 *
 * At the default camera (zoom 15.1) one pixel is 3.34 metres. A 4.3 m car is
 * therefore 1.3 pixels long and a 1.95 m motorcycle is 0.58 — smaller than a
 * pixel, i.e. invisible. Rendered at true scale the city looks completely
 * empty while several hundred vehicles are in fact being drawn every frame.
 *
 * So vehicles are exaggerated as the camera pulls back, on the rule that a car
 * never renders shorter than MIN_CAR_PX. At street level the factor falls to 1
 * and everything is true-to-life. This is the same treatment the signal heads
 * already get, for exactly the same reason.
 *
 * The exaggeration is UNIFORM. An earlier version held width back with a
 * separate cap, on the reasoning that scaling every axis together would turn a
 * car into a blob wider than its lane. That reasoning was wrong, and visibly
 * so once the scene was finally rendered: freezing width while length kept
 * growing to the cap drew a 30 m x 4.4 m sliver at wide zooms — an aspect ratio
 * of 6.8:1 against a real car's 2.32:1. The overview did not show traffic, it
 * showed coloured needles.
 *
 * Uniform scaling cannot produce a blob here, because `s` is derived from a
 * LENGTH target: a car drawn MIN_CAR_PX long is, by its own proportions,
 * MIN_CAR_PX * 1.85 / 4.3 = 3 px wide at every zoom. The pixel width is
 * self-limiting, so the cap was defending against something the length target
 * had already ruled out — while causing the distortion it was meant to prevent.
 */
const MIN_CAR_PX = 7.0
const CAR_LENGTH_M = 4.3
const SCALE_CAP = 7.0

/** Metres per pixel at a given MapLibre zoom and latitude. */
function metresPerPixel(zoom, lat) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom)
}

/**
 * Live traffic as GPU-instanced 3D meshes.
 *
 * One InstancedMesh per vehicle type means the entire fleet costs four draw
 * calls no matter how many vehicles are on screen.
 *
 * MOTION: the wire format carries no vehicle IDs, only a flat array that can
 * reorder between ticks, so vehicles cannot be matched frame to frame and
 * therefore cannot be interpolated. Instead each vehicle is DEAD-RECKONED:
 * every tick gives position, heading and speed, and between ticks we advance
 * along the heading at that speed. Data arrives about 5 times a second and
 * this runs at display rate, so the traffic flows continuously rather than
 * stepping. Cornering drifts a little before the next tick corrects it, which
 * at city zoom is invisible.
 */
export function createTraffic({ scene, proj }) {
  const group = new Group()
  group.name = 'traffic'

  const carMesh = new InstancedMesh(
    carGeometry(), vehicleMaterial(COLOR.car), CAPACITY.car
  )
  const busMesh = new InstancedMesh(
    busGeometry(), vehicleMaterial(COLOR.bus), CAPACITY.bus
  )
  const busGlow = new InstancedMesh(
    busWindowGeometry(), glowMaterial(COLOR.bus), CAPACITY.bus
  )
  const bikeMesh = new InstancedMesh(
    bikeGeometry(), vehicleMaterial(COLOR.bike), CAPACITY.bike
  )
  const truckMesh = new InstancedMesh(
    truckGeometry(), vehicleMaterial(COLOR.truck), CAPACITY.truck
  )
  const motoMesh = new InstancedMesh(
    motoGeometry(), vehicleMaterial(COLOR.moto), CAPACITY.moto
  )

  const meshes = [carMesh, busMesh, busGlow, bikeMesh, truckMesh, motoMesh]
  for (const m of meshes) {
    m.count = 0
    // Instances move every frame, so a bounding sphere computed once is wrong
    // immediately; culling on it makes vehicles vanish in blocks.
    m.frustumCulled = false
    m.castShadow = false
    m.receiveShadow = false
    group.add(m)
  }
  carMesh.name = 'cars'
  busMesh.name = 'buses'
  bikeMesh.name = 'bikes'
  truckMesh.name = 'trucks'
  motoMesh.name = 'motos'
  busGlow.name = 'bus-glow'

  scene.add(group)

  // ---- per-tick state, kept in flat typed arrays -----------------------
  // Geographic -> scene projection runs ONCE per data tick, not per rendered
  // frame: it costs a log and a tan per vehicle, and doing that for thousands
  // of vehicles at display rate is a real cost for no benefit. Dead reckoning
  // afterwards is plain arithmetic in metres.
  let count = 0
  let cap = 0
  let px = new Float32Array(0)   // scene x at tick time
  let py = new Float32Array(0)
  let dx = new Float32Array(0)   // unit heading
  let dy = new Float32Array(0)
  let spd = new Float32Array(0)
  let knd = new Uint8Array(0)
  let stopped = new Uint8Array(0)
  let tickAt = 0
  let lastSimTime = -1
  let lastDropped = 0

  // Heading is INTERPOLATED, position is not.
  //
  // A vehicle's heading arrives once per simulation tick and can change by 90°
  // in a single step at a corner. Applied raw that is an instantaneous snap —
  // and the slower the simulation runs, the more violent it looks, because the
  // same 90° lands in one frame however long the tick took. Turning the yaw
  // toward its target over the tick interval, by the shortest arc, is what
  // makes a turn read as a turn.
  let yaw = new Float32Array(0)      // this tick's measured heading
  let yawRate = new Float32Array(0)  // radians turned over the last tick
  // Measured inter-tick interval. The extrapolation window has to track the
  // real data rate: a fixed clamp that assumed ~200 ms ticks left vehicles
  // frozen for 3.6 s of every 4 s once the simulation slowed down.
  let tickInterval = 0.25
  let colourEpoch = -2

  // Per-mesh record of what each instance SLOT was last painted, so colour
  // uploads happen only on change.
  const carState = new Uint8Array(CAPACITY.car).fill(255)
  const busState = new Uint8Array(CAPACITY.bus).fill(255)
  const bikeState = new Uint8Array(CAPACITY.bike).fill(255)
  const truckState = new Uint8Array(CAPACITY.truck).fill(255)
  const motoState = new Uint8Array(CAPACITY.moto).fill(255)

  const grow = (n) => {
    if (n <= cap) return
    cap = Math.ceil(n * 1.3)
    px = new Float32Array(cap)
    py = new Float32Array(cap)
    dx = new Float32Array(cap)
    dy = new Float32Array(cap)
    spd = new Float32Array(cap)
    knd = new Uint8Array(cap)
    stopped = new Uint8Array(cap)
    yaw = new Float32Array(cap)
    yawRate = new Float32Array(cap)
  }

  const mat = new Matrix4()
  const pos = new Vector3()
  const quat = new Quaternion()
  const scl = new Vector3(1, 1, 1)
  let lastScale = 1
  const zAxis = new Vector3(0, 0, 1)
  const col = new Color()

  return {
    group,

    /** Ingest one simulation tick. Returns the vehicle count, or -1 if stale. */
    applyFrame(frame) {
      const simTime = frame?.header?.sim_time ?? -1
      if (simTime === lastSimTime) return -1
      lastSimTime = simTime

      const v = frame?.vehicles
      if (!v || !v.length) {
        count = 0
        return 0
      }

      const n = Math.min(v.length / STRIDE, CAPACITY.car + CAPACITY.bus + CAPACITY.bike)
      grow(n)

      // Read index i, WRITE index w. A vehicle that fails validation is
      // dropped rather than written, so the packed arrays stay dense and
      // nothing downstream has to know a gap could exist.
      //
      // WHY VALIDATE AT ALL
      // A NaN longitude does not throw here. It becomes a NaN scene position,
      // then a NaN in an instance matrix, and three.js will happily upload
      // that to the GPU -- at which point the mesh's bounding sphere is NaN,
      // frustum culling stops working, and the whole draw call can vanish.
      // One bad byte on the wire takes out every vehicle of that kind, with
      // nothing in the console to say why. Cheaper to check six floats.
      let w = 0
      let dropped = 0
      for (let i = 0; i < n; i++) {
        const o = i * STRIDE
        const lon = v[o]
        const lat = v[o + 1]
        const ang = v[o + 2]
        const s = v[o + 4]
        if (!Number.isFinite(lon) || !Number.isFinite(lat) ||
            !Number.isFinite(ang) || !Number.isFinite(s)) {
          dropped++
          continue
        }
        const p = proj.toScene(lon, lat, 0)
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
          dropped++
          continue
        }
        px[w] = p.x
        py[w] = p.y
        // SUMO reports degrees CLOCKWISE FROM NORTH. Scene +Y is north, so the
        // unit heading is (sin, cos) — not the usual (cos, sin).
        const a = ang * (Math.PI / 180)
        dx[w] = Math.sin(a)
        dy[w] = Math.cos(a)
        spd[w] = s
        knd[w] = v[o + 3] | 0
        stopped[w] = s < STOPPED_MS ? 1 : 0

        // Heading is clockwise from north; scene rotation about +Z is
        // counter-clockwise, hence the negation.
        yaw[w] = -a
        // How far this vehicle turned over the last tick, carried per-VEHICLE
        // on the wire. It cannot be derived here: the array is repacked every
        // tick and slot i holds the same vehicle only ~36% of the time, so
        // anything remembered per slot belongs to a different car.
        const yr = v[o + 5]
        yawRate[w] = Number.isFinite(yr) ? -(yr * (Math.PI / 180)) : 0
        w++
      }
      count = w
      lastDropped = dropped

      const now = performance.now()
      if (tickAt) {
        // Smoothed, so one slow frame does not make every vehicle lurch.
        const gap = (now - tickAt) / 1000
        if (gap > 0.01 && gap < 10) tickInterval = tickInterval * 0.7 + gap * 0.3
      }
      tickAt = now
      return n
    },

    /**
     * Rebuild instance transforms for this rendered frame, advancing each
     * vehicle along its heading since the last tick.
     */
    tick(zoom = 16, lat = 41.39) {
      const since = (performance.now() - tickAt) / 1000

      // Extrapolate for as long as the data actually takes to arrive, plus a
      // little slack — not a fixed 0.45 s. When the simulation slowed to one
      // tick every 4 s, the old fixed clamp animated each vehicle for 0.45 s
      // and then froze it for 3.6 s, which is what read as broken rendering.
      // Still bounded, so a dead socket makes traffic coast to a halt rather
      // than sail off the map.
      const window_s = Math.min(6.0, tickInterval * 1.35)
      const dt = Math.min(window_s, since)

      // Fraction of the way through this tick, for turning vehicles toward
      // their new heading rather than snapping to it.
      const turn = Math.min(1, since / Math.max(0.05, tickInterval))

      // Colours are rewritten on the first render after new data, and after
      // that only where a slot's state actually changed. Rewriting every
      // instance colour at display rate was ~4,000 wasted uploads per frame.
      const recolour = colourEpoch !== lastSimTime
      colourEpoch = lastSimTime
      let carDirty = false, busDirty = false, bikeDirty = false
      let truckDirty = false, motoDirty = false

      // Keep vehicles legible as the camera pulls back — see the note above.
      const mpp = metresPerPixel(zoom, lat)
      const s = Math.max(1, Math.min(SCALE_CAP, (MIN_CAR_PX * mpp) / CAR_LENGTH_M))
      lastScale = s
      // Uniform: every vehicle keeps its real proportions at every zoom.
      scl.set(s, s, s)

      let nCar = 0
      let nBus = 0
      let nBike = 0
      let nTruck = 0
      let nMoto = 0

      for (let i = 0; i < count; i++) {
        const adv = spd[i] * dt
        pos.set(px[i] + dx[i] * adv, py[i] + dy[i] * adv, 0.35)

        // Continue the vehicle's own turn at the rate it was last turning, so
        // a 90° corner sweeps through instead of flipping in one frame. Same
        // dead-reckoning idea as the position above: extrapolate FORWARD from
        // this vehicle's measured state, never from whatever the slot held
        // last tick.
        quat.setFromAxisAngle(zAxis, yaw[i] + yawRate[i] * turn)
        mat.compose(pos, quat, scl)

        // Colour only needs rewriting when a vehicle's moving/stopped state
        // changed since the last DATA tick. Instance slots are packed per mesh
        // and shift as vehicles enter and leave, so the comparison is against
        // what that slot last held, not against the vehicle.
        const kind = knd[i]
        const st = stopped[i]
        // Each mesh pool is allocated to its own capacity, but the frame cap
        // above is on the TOTAL. A frame whose mix skews hard toward one kind
        // -- a bus-heavy corridor, a depot emptying -- can overrun a single
        // pool while staying under the total, and setMatrixAt past the
        // allocated instance count writes off the end of the buffer. Skip the
        // overflow instead: a few missing buses beats corrupt GPU memory.
        if (kind === KIND_BUS && nBus >= CAPACITY.bus) continue
        if (kind === KIND_BIKE && nBike >= CAPACITY.bike) continue
        if (kind === KIND_TRUCK && nTruck >= CAPACITY.truck) continue
        if (kind === KIND_MOTO && nMoto >= CAPACITY.moto) continue
        if (kind !== KIND_BUS && kind !== KIND_BIKE &&
            kind !== KIND_TRUCK && kind !== KIND_MOTO && nCar >= CAPACITY.car) continue
        if (kind === KIND_BUS) {
          busMesh.setMatrixAt(nBus, mat)
          busGlow.setMatrixAt(nBus, mat)
          if (recolour || busState[nBus] !== st) {
            busState[nBus] = st
            busMesh.setColorAt(nBus, col.setHex(st ? COLOR.stopped : COLOR.bus))
            busDirty = true
          }
          nBus++
        } else if (kind === KIND_BIKE) {
          bikeMesh.setMatrixAt(nBike, mat)
          if (recolour || bikeState[nBike] !== st) {
            bikeState[nBike] = st
            bikeMesh.setColorAt(nBike, col.setHex(st ? COLOR.stopped : COLOR.bike))
            bikeDirty = true
          }
          nBike++
        } else if (kind === KIND_TRUCK) {
          truckMesh.setMatrixAt(nTruck, mat)
          if (recolour || truckState[nTruck] !== st) {
            truckState[nTruck] = st
            truckMesh.setColorAt(nTruck, col.setHex(st ? COLOR.stopped : COLOR.truck))
            truckDirty = true
          }
          nTruck++
        } else if (kind === KIND_MOTO) {
          motoMesh.setMatrixAt(nMoto, mat)
          if (recolour || motoState[nMoto] !== st) {
            motoState[nMoto] = st
            motoMesh.setColorAt(nMoto, col.setHex(st ? COLOR.stopped : COLOR.moto))
            motoDirty = true
          }
          nMoto++
        } else {
          carMesh.setMatrixAt(nCar, mat)
          if (recolour || carState[nCar] !== st) {
            carState[nCar] = st
            carMesh.setColorAt(nCar, col.setHex(st ? COLOR.stopped : COLOR.car))
            carDirty = true
          }
          nCar++
        }
      }

      carMesh.count = nCar
      busMesh.count = nBus
      busGlow.count = nBus
      bikeMesh.count = nBike
      truckMesh.count = nTruck
      motoMesh.count = nMoto

      // Transforms change every frame (vehicles are dead-reckoned); colours
      // only when a slot's state moved.
      for (const m of meshes) m.instanceMatrix.needsUpdate = true
      if (carDirty && carMesh.instanceColor) carMesh.instanceColor.needsUpdate = true
      if (busDirty && busMesh.instanceColor) busMesh.instanceColor.needsUpdate = true
      if (bikeDirty && bikeMesh.instanceColor) bikeMesh.instanceColor.needsUpdate = true
      if (truckDirty && truckMesh.instanceColor) truckMesh.instanceColor.needsUpdate = true
      if (motoDirty && motoMesh.instanceColor) motoMesh.instanceColor.needsUpdate = true

      return { cars: nCar, buses: nBus, bikes: nBike, trucks: nTruck, motos: nMoto }
    },

    setVisible(on) {
      group.visible = on !== false
    },

    stats: () => ({
      vehicles: count,
      // Non-finite vehicles silently discarded on the last frame. Reported so
      // a wire-format regression shows up as a number rather than as traffic
      // that mysteriously thins out.
      dropped: lastDropped,
      cars: carMesh.count,
      buses: busMesh.count,
      bikes: bikeMesh.count,
      trucks: truckMesh.count,
      motos: motoMesh.count,
      drawCalls: meshes.length,
      scale: +lastScale.toFixed(2),
      capacity: CAPACITY,
    }),

    dispose() {
      for (const m of meshes) {
        m.geometry.dispose()
        m.material.dispose()
      }
      scene.remove(group)
    },
  }
}
