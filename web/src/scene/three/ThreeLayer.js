import * as THREE from 'three'
import { createProjection, lngLatToMercator, mercatorScaleDenominator } from './geo'

/**
 * A three.js scene hosted inside MapLibre as a custom layer.
 *
 * MapLibre owns the canvas and the WebGL context; we are a guest in it. Three
 * things follow from that, and each one is a silent-failure trap if missed:
 *
 *   1. The renderer must be constructed with MapLibre's existing `gl` context
 *      rather than making its own, or nothing we draw appears.
 *   2. `renderer.resetState()` must run before every render. three.js caches
 *      what it believes the GL state to be; MapLibre has been changing that
 *      state behind its back all frame. Skip this and you get symptoms that
 *      look like anything except a state cache — vanishing basemap, inverted
 *      depth, textures bleeding between layers.
 *   3. `autoClear = false`, or we wipe the map we are drawing on top of.
 *
 * The camera carries no projection of its own. MapLibre hands us a matrix that
 * maps Mercator space to clip space each frame; we pre-multiply our
 * metres-to-Mercator model matrix into it. That way the map controls the camera
 * completely and our scene simply lives in the world, which is what keeps pan,
 * zoom, rotate and pitch working with no synchronisation code at all.
 */
export function createThreeLayer({ id = 'mst-three', origin, onInit, onFrame }) {
  const proj = createProjection(origin)

  let map = null
  let renderer = null
  let scene = null
  let camera = null
  let modelMatrix = null
  let disposed = false

  const layer = {
    id,
    type: 'custom',
    renderingMode: '3d',
    proj,

    get scene() {
      return scene
    },
    get renderer() {
      return renderer
    },

    /** Ask MapLibre for another frame. Needed whenever the scene animates. */
    redraw() {
      map?.triggerRepaint()
    },

    onAdd(_map, gl) {
      map = _map
      scene = new THREE.Scene()
      // A bare Camera: we overwrite projectionMatrix every frame, so any
      // intrinsics it might have had would be discarded anyway.
      camera = new THREE.Camera()

      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
      })
      renderer.autoClear = false
      renderer.outputColorSpace = THREE.SRGBColorSpace
      // No shadow maps. On the target hardware (Intel N100, integrated
      // graphics) a shadow pass over a few thousand instanced vehicles costs
      // far more than it returns. Vehicles get a baked contact shadow instead.
      renderer.shadowMap.enabled = false

      // ---- scene-metres -> Mercator ------------------------------------
      // Scene space is x=east, y=north, z=up, in metres from `origin`.
      // Mercator is x=east, y=SOUTH, z=up, in unit-square units. Hence the
      // negated y scale — the single most common way to get this wrong, and it
      // fails by mirroring the whole city about its centre line, which is
      // subtle enough to miss on a dark basemap.
      const o = lngLatToMercator(origin[0], origin[1], 0)
      const u = 1 / mercatorScaleDenominator(origin[1]) // Mercator units per metre
      modelMatrix = new THREE.Matrix4().set(
        u, 0, 0, o.x,
        0, -u, 0, o.y,
        0, 0, u, o.z,
        0, 0, 0, 1
      )

      addLights(scene)
      onInit?.({ scene, proj, renderer, layer })
    },

    render(gl, matrix) {
      if (disposed || !renderer) return
      onFrame?.()

      camera.projectionMatrix = new THREE.Matrix4()
        .fromArray(matrix)
        .multiply(modelMatrix)

      renderer.resetState()
      renderer.render(scene, camera)
    },

    onRemove() {
      disposed = true
      scene?.traverse((obj) => {
        obj.geometry?.dispose?.()
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.())
        else obj.material?.dispose?.()
      })
      // Do NOT call renderer.dispose(): the context belongs to MapLibre and
      // disposing it would take the basemap down with us.
      renderer = null
      scene = null
    },
  }

  return layer
}

/**
 * Lighting.
 *
 * Kept cool and neutral on purpose. A warm key light flatters vehicles but puts
 * warm highlights across the whole city, and terracotta then stops being the
 * only warm thing on screen — which is the entire basis of the colour system.
 */
function addLights(scene) {
  scene.add(new THREE.AmbientLight(0x93a3bd, 1.5))

  // Key light from the north-west, high enough to leave readable shading on
  // vehicle roofs (which is nearly all you see from a map camera).
  const key = new THREE.DirectionalLight(0xffffff, 2.2)
  key.position.set(-0.45, 0.6, 1).normalize()
  scene.add(key)

  // Cool bounce from the opposite side so the shadowed flank never goes to
  // pure black against a dark basemap.
  const fill = new THREE.DirectionalLight(0x7d93b8, 0.9)
  fill.position.set(0.6, -0.4, 0.35).normalize()
  scene.add(fill)
}

export { THREE }
