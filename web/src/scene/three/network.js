import {
  Group, Mesh,
} from 'three'
import { buildRibbons, ribbonMaterial, setFeatureColor } from './ribbons'
import { congestionRGBA } from '../congestion'

/**
 * The street network as three.js geometry: the simulated road graph coloured by
 * live congestion, plus Barcelona's real published cycle network underneath it.
 *
 * Two meshes, two draw calls, for ~4,400 features.
 */
export function createNetwork({ scene, proj, roads, bikeLanes }) {
  const group = new Group()
  group.name = 'network'

  // ---- simulated road network -------------------------------------------
  const roadWidth = (f) =>
    // The exported `w` is a display weight (2–5), not a real carriageway width.
    // Scaling it to metres here keeps the ribbon proportionate as you zoom to
    // street level, where a 2 m "arterial" would look absurd next to an 18 m bus.
    ({ arterial: 3.4, distributor: 2.6, local: 2.0 }[f.tier] ?? 2.0) * (f.w || 2)

  const road = buildRibbons(roads, proj, { width: roadWidth, z: 0.5 })
  const roadMesh = new Mesh(road.geometry, ribbonMaterial())
  roadMesh.name = 'roads'
  roadMesh.renderOrder = 1
  roadMesh.frustumCulled = false
  group.add(roadMesh)

  // Paint everything free-flowing to start, so the first frame before any
  // simulation data arrives looks intentional rather than black.
  for (let i = 0; i < roads.length; i++) {
    const [r, g, b, a] = congestionRGBA(255, roads[i].tier)
    setFeatureColor(road.geometry, road.ranges, i, r, g, b, a)
  }
  road.geometry.getAttribute('color').needsUpdate = true

  // ---- real cycle network (Open Data BCN) --------------------------------
  let bike = null
  if (bikeLanes?.length) {
    bike = buildRibbons(bikeLanes, proj, { width: 2.6, z: 1.0 })
    const bikeMesh = new Mesh(bike.geometry, ribbonMaterial())
    bikeMesh.name = 'bike-lanes'
    bikeMesh.renderOrder = 2
    bikeMesh.frustumCulled = false
    for (let i = 0; i < bikeLanes.length; i++) {
      setFeatureColor(bike.geometry, bike.ranges, i, 0.22, 0.84, 0.96, 0.5)
    }
    bike.geometry.getAttribute('color').needsUpdate = true
    group.add(bikeMesh)
  }

  scene.add(group)

  // Only repaint edges whose congestion bucket actually moved. Most of the
  // network is unchanged between ticks, and rewriting all ~4,000 edges' colours
  // every update is wasted work on a machine this size.
  const lastBucket = new Uint8Array(roads.length).fill(255)

  return {
    group,
    roadMesh,

    /** @param {Uint8Array|null} cong one byte per road feature, 0..255 */
    updateCongestion(cong) {
      if (!cong || cong.length < roads.length) return 0
      let changed = 0
      for (let i = 0; i < roads.length; i++) {
        // 16 buckets: finer than the ramp can express, coarse enough that
        // speed noise doesn't cause a full-network rewrite every tick.
        const bucket = cong[i] >> 4
        if (bucket === lastBucket[i]) continue
        lastBucket[i] = bucket
        const [r, g, b, a] = congestionRGBA(cong[i], roads[i].tier)
        setFeatureColor(road.geometry, road.ranges, i, r, g, b, a)
        changed++
      }
      if (changed) road.geometry.getAttribute('color').needsUpdate = true
      return changed
    },

    setVisible({ roads: showRoads = true, bike: showBike = true } = {}) {
      roadMesh.visible = showRoads
      const b = group.getObjectByName('bike-lanes')
      if (b) b.visible = showBike
    },

    stats: () => ({
      roadFeatures: roads.length,
      roadSegments: road.segCount,
      roadVertices: road.vertexCount,
      bikeFeatures: bikeLanes?.length ?? 0,
      bikeSegments: bike?.segCount ?? 0,
      drawCalls: bike ? 2 : 1,
    }),
  }
}
