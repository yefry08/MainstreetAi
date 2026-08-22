import * as THREE from 'three'

/**
 * Traffic signals as 3D objects with live state.
 *
 * 1,151 real Barcelona junctions, each a mast and a lit head, in three draw
 * calls. State arrives as one byte per signal in signals.geojson order:
 * 0 red, 1 amber, 2 green.
 *
 * THE SCALE PROBLEM, and why the heads are not life-sized:
 * A real signal head is about 0.3 m across. At zoom 15 that is roughly three
 * hundredths of a pixel — mathematically present, visually nonexistent. So the
 * heads scale with zoom: life-sized when the camera is down at street level
 * where you can actually see a signal, and progressively exaggerated as you
 * pull out, so a city-wide view still shows the signal network pulsing. The
 * alternative is a map of 1,151 invisible objects.
 */

const RED = 0xf0454f
const AMBER = 0xfbbf24
const GREEN = 0x4ade80

const STATE_COLOR = [RED, AMBER, GREEN]

export function createSignals({ scene, proj, signals }) {
  const n = signals.length
  const group = new THREE.Group()
  group.name = 'signals'

  // ---- geometry ---------------------------------------------------------
  // Mast: a thin post. Built with its base at z=0 and its length along +Z.
  const mastGeo = new THREE.BoxGeometry(0.16, 0.16, 3.4)
  mastGeo.translate(0, 0, 1.7)

  // Head: the lit lamp, sitting on top of the mast.
  const headGeo = new THREE.BoxGeometry(0.62, 0.42, 0.92)
  headGeo.translate(0, 0, 3.75)

  // Halo: a larger, additively blended shell around the head. This is what
  // makes a signal read as a LIGHT rather than a coloured cube — at night a
  // lamp bleeds into the air around it, and without that the heads look like
  // confetti scattered over the city.
  const haloGeo = new THREE.BoxGeometry(1.9, 1.9, 2.2)
  haloGeo.translate(0, 0, 3.75)

  const mastMesh = new THREE.InstancedMesh(
    mastGeo,
    new THREE.MeshLambertMaterial({ color: 0x2b3038 }),
    n
  )
  // Unlit: a signal lamp emits, it is not lit by the scene.
  const headMesh = new THREE.InstancedMesh(
    headGeo,
    new THREE.MeshBasicMaterial({ toneMapped: false }),
    n
  )
  const haloMesh = new THREE.InstancedMesh(
    haloGeo,
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
    n
  )

  const meshes = [mastMesh, headMesh, haloMesh]
  for (const m of meshes) {
    m.frustumCulled = false
    group.add(m)
  }
  mastMesh.name = 'signal-masts'
  headMesh.name = 'signal-heads'
  haloMesh.name = 'signal-halos'
  haloMesh.renderOrder = 3

  // ---- fixed positions --------------------------------------------------
  // Signals never move, so project once at construction.
  const sx = new Float32Array(n)
  const sy = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const p = proj.toScene(signals[i].pos[0], signals[i].pos[1], 0)
    sx[i] = p.x
    sy[i] = p.y
  }

  scene.add(group)

  const mat = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scl = new THREE.Vector3(1, 1, 1)
  const col = new THREE.Color()

  let lastScale = -1
  let lastStateKey = ''

  return {
    group,

    /**
     * @param {Uint8Array|null} state one byte per signal, 0/1/2
     * @param {number} zoom current map zoom, drives head exaggeration
     */
    update(state, zoom) {
      // Life-sized at street level, exaggerated as the camera pulls out.
      const scale = Math.min(14, Math.max(1, Math.pow(2, 16.5 - zoom)))

      // Transforms only change when the zoom-driven scale changes, so panning
      // and rotating cost nothing here.
      if (Math.abs(scale - lastScale) > 0.01) {
        lastScale = scale
        for (let i = 0; i < n; i++) {
          pos.set(sx[i], sy[i], 0)
          // Masts stay slim as they grow so they do not become towers; the
          // head is what needs to be seen.
          scl.set(scale, scale, Math.min(scale, 3))
          mat.compose(pos, quat, scl)
          mastMesh.setMatrixAt(i, mat)
          headMesh.setMatrixAt(i, mat)
          haloMesh.setMatrixAt(i, mat)
        }
        mastMesh.instanceMatrix.needsUpdate = true
        headMesh.instanceMatrix.needsUpdate = true
        haloMesh.instanceMatrix.needsUpdate = true
      }

      if (!state || state.length < n) return { scale, repainted: 0 }

      // Repainting 1,151 instance colours every frame is wasted work — signal
      // state changes at most once a second. A cheap sample of the array tells
      // us whether anything actually changed.
      const key = `${state[0]}${state[(n / 3) | 0]}${state[(n / 2) | 0]}${state[n - 1]}${state.length}`
      if (key === lastStateKey) return { scale, repainted: 0 }
      lastStateKey = key

      for (let i = 0; i < n; i++) {
        const c = STATE_COLOR[state[i]] ?? RED
        headMesh.setColorAt(i, col.setHex(c))
        haloMesh.setColorAt(i, col.setHex(c))
      }
      if (headMesh.instanceColor) headMesh.instanceColor.needsUpdate = true
      if (haloMesh.instanceColor) haloMesh.instanceColor.needsUpdate = true
      return { scale, repainted: n }
    },

    setVisible(on) {
      group.visible = on !== false
    },

    /** Nearest signal to a lng/lat, for click-to-inspect. */
    nearest(lng, lat, maxMetres = 90) {
      const p = proj.toScene(lng, lat, 0)
      let best = -1
      let bestD = maxMetres * maxMetres
      for (let i = 0; i < n; i++) {
        const ddx = sx[i] - p.x
        const ddy = sy[i] - p.y
        const d = ddx * ddx + ddy * ddy
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      return best < 0 ? null : { index: best, ...signals[best], metres: Math.sqrt(bestD) }
    },

    stats: () => ({ signals: n, drawCalls: 3, headScale: +lastScale.toFixed(2) }),

    dispose() {
      for (const m of meshes) {
        m.geometry.dispose()
        m.material.dispose()
      }
      scene.remove(group)
    },
  }
}
