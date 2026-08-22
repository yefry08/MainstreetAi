import * as THREE from 'three'
import {
  bikeGeometry,
  busGeometry,
  busWindowGeometry,
  carGeometry,
  glowMaterial,
  vehicleMaterial,
} from './vehicleMeshes'

// From design/tokens.css. Cars are a dim steel mass; buses glow from within,
// because transit priority is the argument and the mode carrying eighty people
// should be the brightest thing on the street.
const COLOR = {
  car: 0x7e8ca3,
  bus: 0xffe3b0,
  bike: 0x4fd8e8,
  stopped: 0xe0414f,
}

const KIND_CAR = 0
const KIND_BUS = 1
const KIND_BIKE = 2

// Generous headroom; peak observed load is ~2,300 vehicles across all modes.
const CAPACITY = { car: 4200, bus: 700, bike: 1600 }

/** Below this (m/s) a vehicle is queued, and turns red. */
const STOPPED_MS = 0.6

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
  const group = new THREE.Group()
  group.name = 'traffic'

  const carMesh = new THREE.InstancedMesh(
    carGeometry(), vehicleMaterial(COLOR.car), CAPACITY.car
  )
  const busMesh = new THREE.InstancedMesh(
    busGeometry(), vehicleMaterial(COLOR.bus), CAPACITY.bus
  )
  const busGlow = new THREE.InstancedMesh(
    busWindowGeometry(), glowMaterial(COLOR.bus), CAPACITY.bus
  )
  const bikeMesh = new THREE.InstancedMesh(
    bikeGeometry(), vehicleMaterial(COLOR.bike), CAPACITY.bike
  )

  const meshes = [carMesh, busMesh, busGlow, bikeMesh]
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
  }

  const mat = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scl = new THREE.Vector3(1, 1, 1)
  const zAxis = new THREE.Vector3(0, 0, 1)
  const col = new THREE.Color()

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

      const n = Math.min(v.length / 5, CAPACITY.car + CAPACITY.bus + CAPACITY.bike)
      grow(n)

      for (let i = 0; i < n; i++) {
        const o = i * 5
        const p = proj.toScene(v[o], v[o + 1], 0)
        px[i] = p.x
        py[i] = p.y
        // SUMO reports degrees CLOCKWISE FROM NORTH. Scene +Y is north, so the
        // unit heading is (sin, cos) — not the usual (cos, sin).
        const a = v[o + 2] * (Math.PI / 180)
        dx[i] = Math.sin(a)
        dy[i] = Math.cos(a)
        const s = v[o + 4]
        spd[i] = s
        knd[i] = v[o + 3] | 0
        stopped[i] = s < STOPPED_MS ? 1 : 0
      }
      count = n
      tickAt = performance.now()
      return n
    },

    /**
     * Rebuild instance transforms for this rendered frame, advancing each
     * vehicle along its heading since the last tick.
     */
    tick() {
      // Clamp the extrapolation window. If the socket stalls, vehicles should
      // coast to a stop, not sail across the city.
      const dt = Math.min(0.45, (performance.now() - tickAt) / 1000)

      let nCar = 0
      let nBus = 0
      let nBike = 0

      for (let i = 0; i < count; i++) {
        const adv = spd[i] * dt
        pos.set(px[i] + dx[i] * adv, py[i] + dy[i] * adv, 0.35)
        // Heading is clockwise from north; scene rotation about +Z is
        // counter-clockwise, hence the negation.
        quat.setFromAxisAngle(zAxis, -Math.atan2(dx[i], dy[i]))
        mat.compose(pos, quat, scl)

        const kind = knd[i]
        if (kind === KIND_BUS) {
          busMesh.setMatrixAt(nBus, mat)
          busGlow.setMatrixAt(nBus, mat)
          busMesh.setColorAt(nBus, col.setHex(stopped[i] ? COLOR.stopped : COLOR.bus))
          nBus++
        } else if (kind === KIND_BIKE) {
          bikeMesh.setMatrixAt(nBike, mat)
          bikeMesh.setColorAt(nBike, col.setHex(stopped[i] ? COLOR.stopped : COLOR.bike))
          nBike++
        } else {
          carMesh.setMatrixAt(nCar, mat)
          carMesh.setColorAt(nCar, col.setHex(stopped[i] ? COLOR.stopped : COLOR.car))
          nCar++
        }
      }

      carMesh.count = nCar
      busMesh.count = nBus
      busGlow.count = nBus
      bikeMesh.count = nBike

      for (const m of meshes) {
        m.instanceMatrix.needsUpdate = true
        if (m.instanceColor) m.instanceColor.needsUpdate = true
      }

      return { cars: nCar, buses: nBus, bikes: nBike }
    },

    setVisible(on) {
      group.visible = on !== false
    },

    stats: () => ({
      vehicles: count,
      cars: carMesh.count,
      buses: busMesh.count,
      bikes: bikeMesh.count,
      drawCalls: 4,
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
