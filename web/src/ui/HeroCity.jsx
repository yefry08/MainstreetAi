import { useEffect, useRef, useState } from 'react'
import {
  AmbientLight, Color, DirectionalLight, Matrix4, PerspectiveCamera, Quaternion,
  Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three'
import { N, SPACING, makeGrid, buildBlock } from '../city/miniCity'
import { createWorld } from '../city/sim'
import { proportionalPolicy } from '../city/orchestrator'

/**
 * The landing page's small 3D city.
 *
 * A REAL SIMULATION, NOT A LOOP. The cars are stepped by the same engine as
 * "Your city", and the lights are retimed by the same built-in adaptive
 * controller. Stopped cars turn orange. A decorative animation would have been
 * easier, but this whole site's argument is that it shows the mechanism rather
 * than a picture of it, and the first thing on the page should not be the
 * exception.
 *
 * KEPT CHEAP. It runs beside the MapLibre scene behind the page, on hardware
 * as modest as an Intel N100, so: one small grid, a capped pixel ratio, no
 * shadows, and rendering stops whenever the canvas is scrolled out of view.
 * With prefers-reduced-motion it draws one still frame of a running city.
 * Without WebGL it renders nothing rather than a blank box.
 */
const FLEET = 110
const SPAN = (N - 1) * SPACING
const CENTRE = new Vector3(SPAN / 2, 0, SPAN / 2)
// Framing, worked out rather than eyeballed: the grid plus its road overhang
// is ~130 units corner to corner, so ~65 either side of the centre at any
// orbit angle. At FOV 38 the camera sees tan(19deg) x distance either side,
// which needs a distance of ~190+; 165 out and 120 up is ~204. The first cut
// (FOV 34 at 146) saw +-45 and cropped the city's corners.
const FOV = 38
const RADIUS = 165
const HEIGHT = 120
const ORBIT_RAD_PER_S = 0.07          // a full turn in about a minute and a half
const DECIDE_EVERY_S = 3

export default function HeroCity() {
  const mountRef = useRef(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    let renderer
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setFailed(true)
      return
    }
    renderer.outputColorSpace = SRGBColorSpace
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    mount.appendChild(renderer.domElement)

    const scene = new Scene()
    scene.add(new AmbientLight(0xffffff, 1.4))
    const sun = new DirectionalLight(0xffffff, 1.7)
    sun.position.set(60, 90, 40)
    scene.add(sun)

    const grid = makeGrid()
    const world = createWorld(grid, { vehicles: FLEET, seed: 7 })
    const block = buildBlock(grid, FLEET, 0)
    scene.add(block.group)

    const camera = new PerspectiveCamera(FOV, 1, 1, 1000)
    const resize = () => {
      const w = mount.clientWidth || 480
      const h = mount.clientHeight || 420
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(mount)

    const mat = new Matrix4()
    const pos = new Vector3()
    const quat = new Quaternion()
    const one = new Vector3(1, 1, 1)
    const moving = new Color(0xded8d0)
    const stopped = new Color(0xd97757)

    const paint = () => {
      for (let i = 0; i < world.fleet.length; i++) {
        const v = world.fleet[i]
        const e = grid.edges[v.edge]
        if (!e) continue
        const f = (v.fwd ? v.pos : e.len - v.pos) / e.len
        pos.set(e.pts[0][0] + (e.pts[1][0] - e.pts[0][0]) * f, 1.9,
                e.pts[0][1] + (e.pts[1][1] - e.pts[0][1]) * f)
        mat.compose(pos, quat, one)
        block.cars.setMatrixAt(i, mat)
        block.cars.setColorAt(i, v.speed < 0.2 ? stopped : moving)
      }
      block.cars.instanceMatrix.needsUpdate = true
      if (block.cars.instanceColor) block.cars.instanceColor.needsUpdate = true
      world.signals.forEach((s, i) => {
        const m = block.signalMeshes[i]
        if (!m) return
        m.material.color.setHex(s.state === 0 ? 0x3fb34f : 0xf2b134)
        m.material.emissive.setHex(s.state === 0 ? 0x1a4a20 : 0x4a3a10)
      })
    }

    let angle = 0.7
    const place = () => {
      camera.position.set(CENTRE.x + Math.cos(angle) * RADIUS, HEIGHT,
                          CENTRE.z + Math.sin(angle) * RADIUS)
      camera.lookAt(CENTRE)
    }

    let sinceDecide = 0
    const advance = (dt) => {
      world.step(dt)
      sinceDecide += dt
      if (sinceDecide >= DECIDE_EVERY_S) {
        sinceDecide = 0
        proportionalPolicy(world)
      }
    }

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let alive = true
    let raf = 0
    let visible = true
    let io = null

    if (reduced) {
      // A still frame of a city already in motion, rather than an empty grid.
      for (let t = 0; t < 40; t += 0.25) advance(0.25)
      paint(); place(); renderer.render(scene, camera)
    } else {
      // Nothing to draw when nobody can see it.
      io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting })
      io.observe(mount)

      let last = performance.now()
      const tick = () => {
        if (!alive) return
        raf = requestAnimationFrame(tick)
        const now = performance.now()
        const dt = Math.min(0.1, (now - last) / 1000)
        last = now
        if (!visible) return
        advance(dt)
        angle += dt * ORBIT_RAD_PER_S
        paint(); place()
        renderer.render(scene, camera)
      }
      raf = requestAnimationFrame(tick)
    }

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      io?.disconnect()
      ro.disconnect()
      scene.traverse((o) => {
        o.geometry?.dispose?.()
        o.material?.dispose?.()
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  if (failed) return null
  return (
    <div className="land-city" ref={mountRef}
         role="img"
         aria-label="A small 3D city: cars drive a grid of streets while adaptive traffic lights change; stopped cars turn orange." />
  )
}
