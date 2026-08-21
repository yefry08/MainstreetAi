import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { addBuildings } from './buildings'
import { INITIAL } from './cameraPresets'
import { createThreeLayer } from './three/ThreeLayer'
import { createNetwork } from './three/network'
import { verifyProjection } from './three/geo'

// Free, key-less vector tiles serving the OpenMapTiles schema, which carries
// per-building `render_height` — that is what lets us extrude real Barcelona
// footprints rather than fake a skyline. Second entry is a live fallback.
const STYLES = [
  'https://tiles.openfreemap.org/styles/dark',
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
]

// Scene origin, near the middle of the simulated extract. Everything three.js
// draws is expressed in metres from here — see three/geo.js for why.
const ORIGIN = [2.1662, 41.3925]

export default function Scene({ frameRef, onMapReady, layerToggles }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const threeRef = useRef(null)
  const netRef = useRef(null)
  const dataRef = useRef({ roads: null, signals: null, bikeLanes: null })
  const togglesRef = useRef(layerToggles)
  togglesRef.current = layerToggles
  const lastSimTime = useRef(-1)

  useEffect(() => {
    let cancelled = false
    let raf

    const boot = async () => {
      const [roads, signals, bikeLanes] = await Promise.all([
        fetch('/data/roads.geojson').then((r) => r.json()),
        fetch('/data/signals.geojson').then((r) => r.json()),
        fetch('/data/bike_lanes.geojson')
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ])
      if (cancelled) return

      dataRef.current.roads = roads.features.map((f) => ({
        path: f.geometry.coordinates,
        w: f.properties.w,
        tier: f.properties.tier,
        name: f.properties.name,
      }))
      dataRef.current.signals = signals.features.map((f) => ({
        pos: f.geometry.coordinates,
        id: f.properties.id,
        label: f.properties.label,
        links: f.properties.links,
        phases: f.properties.phases,
        corridor: f.properties.corridor,
      }))
      dataRef.current.bikeLanes =
        bikeLanes?.features?.map((f) => ({
          path: f.geometry.coordinates,
          name: f.properties.name,
        })) || null

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: STYLES[0],
        center: INITIAL.center,
        zoom: INITIAL.zoom,
        pitch: INITIAL.pitch,
        bearing: INITIAL.bearing,
        antialias: true,

        // --- free navigation ---
        maxPitch: 85, // MapLibre's ceiling; effectively street level
        minZoom: 10,
        maxZoom: 19,
        dragRotate: true,
        pitchWithRotate: true,
        touchPitch: true,
        keyboard: true,
        attributionControl: { compact: true },
      })
      mapRef.current = map
      map.scrollZoom.setZoomRate(1 / 180)
      map.dragRotate.enable()
      map.touchZoomRotate.enableRotation()

      let styleIdx = 0
      map.on('error', (e) => {
        if (styleIdx === 0 && e?.error?.status >= 400) {
          styleIdx = 1
          map.setStyle(STYLES[1])
        }
      })

      // Attach on 'style.load', NOT 'load'. These basemaps carry a low-zoom
      // Natural Earth raster that never reports ready at city zoom, so 'load'
      // can simply never fire — and the whole 3D layer would be silently
      // missing with no error anywhere to explain it.
      map.on('style.load', () => {
        addBuildings(map)

        if (!threeRef.current) {
          const layer = createThreeLayer({
            origin: ORIGIN,
            onInit: ({ scene, proj }) => {
              netRef.current = createNetwork({
                scene,
                proj,
                roads: dataRef.current.roads,
                bikeLanes: dataRef.current.bikeLanes,
              })
            },
          })
          threeRef.current = layer
          map.addLayer(layer)
          cancelAnimationFrame(raf)
          raf = requestAnimationFrame(tick)
        }
        onMapReady?.(map)
      })

      window.__mst = {
        map,
        get three() {
          return threeRef.current
        },
        get network() {
          return netRef.current
        },
        forceTick: () => {
          lastSimTime.current = -1
          return pump()
        },
        stats: () => ({
          styleLoaded: map.isStyleLoaded(),
          buildings: !!map.getLayer('mst-buildings'),
          threeLayer: !!map.getLayer('mst-three'),
          camera: {
            center: map.getCenter().toArray().map((n) => +n.toFixed(5)),
            zoom: +map.getZoom().toFixed(2),
            pitch: +map.getPitch().toFixed(1),
            bearing: +map.getBearing().toFixed(1),
          },
          sceneChildren:
            threeRef.current?.scene?.children?.map((c) => c.name || c.type) ?? null,
          network: netRef.current?.stats?.() ?? null,
          frame: frameRef?.current?.header?.clock,
          // Cross-check our hand-rolled projection against MapLibre's own.
          projection: verifyProjection(maplibregl, [
            [2.1662, 41.3925],
            [2.1228, 41.3809],
            [2.1866, 41.4038],
            [2.1744, 41.4036],
          ]),
        }),
      }
    }

    /** Push new simulation state into the scene. Returns what it changed. */
    const pump = () => {
      const net = netRef.current
      const layer = threeRef.current
      if (!net || !layer) return null

      const t = togglesRef.current
      net.setVisible({ roads: t.roads, bike: t.bike })

      const frame = frameRef?.current
      const simTime = frame?.header?.sim_time ?? -1
      if (simTime === lastSimTime.current) return { skipped: true }
      lastSimTime.current = simTime

      const changed = net.updateCongestion(frame?.congestion)
      // MapLibre repaints on demand, not continuously. Without this the scene
      // would only update when the user happens to move the camera.
      layer.redraw()
      return { simTime, edgesRepainted: changed }
    }

    const tick = () => {
      raf = requestAnimationFrame(tick)
      pump()
    }

    boot()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      mapRef.current?.remove()
      delete window.__mst
    }
  }, [frameRef, onMapReady])

  return <div ref={containerRef} className="scene" />
}
