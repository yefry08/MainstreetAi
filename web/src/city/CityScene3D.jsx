import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import {
  BoxGeometry, Color, CylinderGeometry, InstancedMesh, Matrix4, MeshLambertMaterial,
  Quaternion, Vector3,
} from 'three'
import { createThreeLayer } from '../scene/three/ThreeLayer'
import { toLngLat, vehiclePose } from './geometry'

/**
 * Any city, in 3D: real buildings, and the running simulation on top.
 *
 * WHERE THE BUILDINGS COME FROM
 * The same OpenFreeMap vector tiles the Barcelona scene uses as its basemap.
 * Their OpenMapTiles building layer covers the whole planet with footprints
 * and, where OpenStreetMap has it, a height -- so every city in the catalogue,
 * and any place a visitor searches for, stands up in 3D with nothing baked.
 * Many Latin American cities tag few heights, and their buildings then come
 * up at the schema's default: lower and more uniform than the real skyline.
 *
 * WHERE THE TRAFFIC COMES FROM
 * Exactly the world the 2D view draws -- same fleet, same signals, positioned
 * by the same geometry.js -- in a three.js layer anchored at the extract's
 * centre. Graph space is metres east/north of that centre, which is what
 * ThreeLayer expects, so no coordinate is converted twice.
 *
 * FALLING BACK
 * The tiles are a third-party service. If the style or its tiles do not
 * arrive, onFail tells the page to show the 2D view instead -- which needs
 * no network at all -- rather than leaving a black box.
 */
const STYLE = 'https://tiles.openfreemap.org/styles/dark'
const MAX_FLEET = 600
const TILE_TIMEOUT_MS = 10000

// The same desaturated-brown ramp as the Barcelona buildings (scene/buildings.js),
// so the cities read as one product.
const HEIGHT = ['max', 6, ['coalesce', ['get', 'render_height'], 10]]
const COLOR = [
  'interpolate', ['linear'], HEIGHT,
  0, '#241d16', 10, '#33281e', 20, '#413326', 40, '#574433', 80, '#6e5843', 140, '#82684f',
]

/**
 * PIXEL MODE: the same live 3D city, as SimCity-style pixel art.
 *
 * Inspired by SimCABA (Buenos Aires as a SimCity map). Three cheap moves on
 * the map that is already running, so every city -- and any searched place --
 * gets it with nothing baked:
 *   1. render at ~30% resolution and upscale with no smoothing (CSS
 *      image-rendering: pixelated), so every pixel is a crisp block
 *   2. a SimCity palette: grass, water, asphalt, and buildings coloured by
 *      height -- terracotta roofs low, pale stone mid-rise, blue-glass towers
 *   3. the classic 45-degree isometric-style camera
 * Street labels are hidden: pixelated text is unreadable and SimCity has none.
 * Every original paint value is remembered, so leaving pixel mode restores the
 * normal 3D view exactly.
 */
const PIXEL_RATIO = 0.3
const PIXEL_BUILDINGS = [
  'interpolate', ['linear'], HEIGHT,
  0, '#d9a066', 12, '#c9774f', 24, '#d8cdb4', 45, '#a9b8c6', 90, '#7f9fc2', 160, '#5f86b8',
]

function pixelPaint(layer) {
  const id = layer.id
  if (layer.type === 'background') return { 'background-color': '#4c8a3c' }
  if (layer.type === 'fill') {
    if (/water/.test(id)) return { 'fill-color': '#3d7fc4' }
    if (/wood|forest|park|grass|landcover/.test(id)) return { 'fill-color': '#3f7a33' }
    if (/residential|landuse/.test(id)) return { 'fill-color': '#5d9548' }
    if (/aeroway/.test(id)) return { 'fill-color': '#7a7a72' }
  }
  if (layer.type === 'line') {
    if (/water/.test(id)) return { 'line-color': '#3d7fc4' }
    // Runways were left near-black from the dark style: thick black bars.
    if (/aeroway/.test(id)) return { 'line-color': '#9a998f' }
    if (/casing/.test(id)) return { 'line-color': '#3c3c38' }
    if (/highway|road|street|bridge|tunnel/.test(id)) return { 'line-color': '#8c8b84' }
    if (/rail/.test(id)) return { 'line-color': '#6d5a4a' }
  }
  return null
}

function setPixelMode(map, on, saved) {
  if (!map?.getStyle()) return
  map.setPixelRatio(on ? PIXEL_RATIO : (window.devicePixelRatio || 1))
  for (const layer of map.getStyle().layers) {
    if (layer.id === 'city-buildings') {
      const key = `${layer.id}|fill-extrusion-color`
      if (on && !saved.has(key)) saved.set(key, map.getPaintProperty(layer.id, 'fill-extrusion-color'))
      map.setPaintProperty(layer.id, 'fill-extrusion-color', on ? PIXEL_BUILDINGS : saved.get(key))
      continue
    }
    if (layer.type === 'symbol') {
      const key = `${layer.id}|visibility`
      if (on && !saved.has(key)) saved.set(key, map.getLayoutProperty(layer.id, 'visibility') ?? 'visible')
      map.setLayoutProperty(layer.id, 'visibility', on ? 'none' : saved.get(key))
      continue
    }
    const paint = pixelPaint(layer)
    if (!paint) continue
    for (const [prop, value] of Object.entries(paint)) {
      const key = `${layer.id}|${prop}`
      if (on && !saved.has(key)) saved.set(key, map.getPaintProperty(layer.id, prop))
      // A layer whose original value was unset restores to its style default.
      map.setPaintProperty(layer.id, prop, on ? value : (saved.get(key) ?? undefined))
    }
  }
  map.easeTo(on ? { bearing: 45, pitch: 55, duration: 900 } : { bearing: -18, pitch: 58, duration: 900 })
}

export default function CityScene3D({ graph, world, hotspots = [], onFail, pixel = false }) {
  const ref = useRef(null)
  const worldRef = useRef(world)
  const mapRef = useRef(null)
  const [styleReady, setStyleReady] = useState(false)
  const savedPaint = useRef(new Map())
  useEffect(() => { worldRef.current = world }, [world])

  useEffect(() => {
    let map
    try {
      map = new maplibregl.Map({
        container: ref.current,
        style: STYLE,
        center: graph.centre,
        zoom: 15.3,
        pitch: 58,
        bearing: -18,
        maxPitch: 80,
        antialias: true,
        attributionControl: { compact: true },
      })
    } catch (e) {
      onFail?.('3D needs WebGL, which this browser could not start.')
      return undefined
    }
    mapRef.current = map
    map.scrollZoom.setZoomRate(1 / 180)

    // Debug handle, like window.__mst for the Barcelona scene: a backgrounded
    // or non-compositing tab never fires requestAnimationFrame, so nothing
    // renders and no tile is even requested. This drives frames by hand so the
    // 3D view can be inspected regardless.
    window.__city3d = {
      map,
      forceRender: (times = 1) => {
        for (let i = 0; i < times; i++) {
          map.triggerRepaint()
          try { map._render(0) } catch { /* mid style load */ }
        }
        return {
          tilesLoaded: map.isSourceLoaded?.('openmaptiles') ?? false,
          buildings: map.getLayer('city-buildings')
            ? map.querySourceFeatures('openmaptiles', { sourceLayer: 'building' }).length : 0,
        }
      },
    }

    let tilesArrived = false
    let failed = false
    const fail = (why) => {
      if (failed || tilesArrived) return
      failed = true
      onFail?.(why)
    }
    // The clock only runs while the map is actually rendering. MapLibre asks
    // for tiles from its render loop, so a tab that is not drawing frames --
    // backgrounded, minimised, or a window the compositor has parked -- has
    // requested nothing yet. A plain timeout then "proves" the tiles failed
    // and drops the visitor to 2D for no reason; "visible" was not enough
    // either (a parked window reports visible and still draws nothing). Only
    // seconds in which frames were drawn count towards the timeout.
    let waited = 0
    let framesSinceTick = 0
    let timer = null
    const STEP = 1000
    map.on('render', () => { framesSinceTick++ })
    const tick = () => {
      if (tilesArrived || failed) return
      if (framesSinceTick > 0) waited += STEP
      framesSinceTick = 0
      if (waited >= TILE_TIMEOUT_MS) fail('The 3D map tiles did not load, so this is the 2D view.')
      else timer = setTimeout(tick, STEP)
    }
    timer = setTimeout(tick, STEP)
    // The FIRST tile is the proof the service works. Waiting for the source to
    // report fully loaded was wrong: at this pitch the view spans many tiles,
    // and "all of them" routinely took longer than the timeout -- measured, a
    // healthy tile server (370 ms a tile) still tripped the 2D fallback.
    map.on('sourcedata', (e) => {
      if (e.sourceId === 'openmaptiles' && (e.tile || e.isSourceLoaded)) {
        tilesArrived = true
        clearTimeout(timer)
      }
    })
    map.on('error', (e) => {
      if (e?.error?.status >= 400 && !tilesArrived) fail('The 3D map tiles are unavailable, so this is the 2D view.')
    })

    let raf = 0
    map.on('style.load', () => {
      if (map.getLayer('building')) map.setLayoutProperty('building', 'visibility', 'none')
      const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
      map.addLayer({
        id: 'city-buildings',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 13,
        paint: {
          'fill-extrusion-color': COLOR,
          'fill-extrusion-height': HEIGHT,
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.94,
          'fill-extrusion-vertical-gradient': true,
        },
      }, firstSymbol)
      map.setLight({ anchor: 'viewport', color: '#e6d8c6', intensity: 0.38, position: [1.5, 210, 35] })
      setStyleReady(true)

      let cars = null
      let lamps = null
      const mat = new Matrix4()
      const pos = new Vector3()
      const quat = new Quaternion()
      const scale = new Vector3()
      const up = new Vector3(0, 0, 1)
      const moving = new Color(0xded8d0)
      const stopped = new Color(0xd97757)
      const green = new Color(0x3fb34f)
      const amber = new Color(0xf2b134)

      const layer = createThreeLayer({
        id: 'city-traffic',
        origin: graph.centre,
        onInit: ({ scene }) => {
          // Length along x, so a heading is a rotation about z.
          cars = new InstancedMesh(new BoxGeometry(4.4, 2.0, 1.6),
                                   new MeshLambertMaterial({ color: 0xffffff }), MAX_FLEET)
          cars.frustumCulled = false
          scene.add(cars)
          const pole = new CylinderGeometry(0.9, 0.9, 6, 8)
          pole.rotateX(Math.PI / 2)           // cylinder axis y -> z (up)
          lamps = new InstancedMesh(pole, new MeshLambertMaterial({ color: 0xffffff }),
                                    Math.max(1, worldRef.current.signals.length))
          lamps.frustumCulled = false
          scene.add(lamps)
        },
        onFrame: () => {
          const w = worldRef.current
          if (!cars || !w) return
          // At street-level zooms a true-size car is a few pixels long; scale
          // it up as the camera pulls back, as the Barcelona scene does.
          // Tuned on São Paulo at the opening zoom: 2^(16.4 - z) left cars as
          // barely visible specks between the towers.
          const s = Math.min(8, Math.max(1, 2 ** (17.3 - map.getZoom())))
          const n = Math.min(w.fleet.length, MAX_FLEET)
          for (let i = 0; i < n; i++) {
            const p = vehiclePose(graph.edges, w.fleet[i])
            if (!p) continue
            pos.set(p[0], p[1], 0.9 * s)
            quat.setFromAxisAngle(up, p[2])
            scale.set(s, s, s)
            mat.compose(pos, quat, scale)
            cars.setMatrixAt(i, mat)
            cars.setColorAt(i, w.fleet[i].speed < 0.2 ? stopped : moving)
          }
          cars.count = n
          cars.instanceMatrix.needsUpdate = true
          if (cars.instanceColor) cars.instanceColor.needsUpdate = true

          quat.identity()
          w.signals.forEach((sig, i) => {
            pos.set(sig.x, sig.y, 3 * s)
            scale.set(s, s, s)
            mat.compose(pos, quat, scale)
            lamps.setMatrixAt(i, mat)
            lamps.setColorAt(i, sig.state === 0 ? green : amber)
          })
          lamps.instanceMatrix.needsUpdate = true
          if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true
        },
      })
      map.addLayer(layer)

      // The simulation moves every frame; MapLibre otherwise only repaints
      // when the camera does.
      const pump = () => { map.triggerRepaint(); raf = requestAnimationFrame(pump) }
      raf = requestAnimationFrame(pump)
    })

    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(raf)
      mapRef.current = null
      if (window.__city3d?.map === map) delete window.__city3d
      map.remove()
    }
  }, [graph, onFail])

  // Pixel mode on and off, on the live map.
  useEffect(() => {
    const map = mapRef.current
    // The class is toggled here, never through React's className: MapLibre adds
    // its own `maplibregl-map` class to this element, and a React re-render
    // that rewrote the attribute dropped it -- the canvas lost its positioning
    // and spilled over the whole page.
    ref.current?.classList.toggle('pixel', pixel)
    if (!map || !styleReady) return
    if (!pixel && savedPaint.current.size === 0) return   // never switched on
    setPixelMode(map, pixel, savedPaint.current)
  }, [pixel, styleReady])

  // The worst junctions, as numbered pins -- the same numbers as the list.
  // Rebuilt only when WHICH junctions are listed changes: the list is
  // re-sent several times a second with fresh averages, and recreating the
  // pins on every update made them flicker.
  const hotRef = useRef(hotspots)
  hotRef.current = hotspots
  const hotKey = hotspots.map((h) => h.id).join(',')
  useEffect(() => {
    const map = mapRef.current
    if (!map) return undefined
    const markers = hotRef.current.map((h, i) => {
      const el = document.createElement('div')
      el.className = 'city-hot-pin'
      el.textContent = String(i + 1)
      el.setAttribute('aria-label', `Queue hotspot ${i + 1}`)
      return new maplibregl.Marker({ element: el }).setLngLat(toLngLat(graph, h.x, h.y)).addTo(map)
    })
    return () => markers.forEach((m) => m.remove())
  }, [hotKey, graph])

  return (
    <div className="city-3d" ref={ref} role="img"
         aria-label="3D view of the city: real buildings, with the simulated traffic and traffic lights." />
  )
}
