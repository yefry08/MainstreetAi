import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { PathLayer } from '@deck.gl/layers'
import { addBuildings } from './buildings'
import { INITIAL } from './cameraPresets'

// Free, key-less vector tiles serving the OpenMapTiles schema, which carries
// per-building `render_height` — that is what lets us extrude real Barcelona
// footprints rather than fake a skyline. Second entry is a live fallback.
const STYLES = [
  'https://tiles.openfreemap.org/styles/dark',
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
]

export default function Scene({ frameRef, onMapReady, layerToggles }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const overlayRef = useRef(null)
  const dataRef = useRef({ roads: null, signals: null, bikeLanes: null })
  const dirtyRef = useRef('')
  const togglesRef = useRef(layerToggles)
  togglesRef.current = layerToggles

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

        // --- free navigation ------------------------------------------------
        // 85° is MapLibre's ceiling and puts the camera very nearly at street
        // level, which is where a traffic simulation is worth looking at.
        maxPitch: 85,
        minZoom: 10,
        maxZoom: 19,
        dragRotate: true,
        pitchWithRotate: true,
        touchPitch: true,
        keyboard: true,
        // Zoom toward the cursor rather than the screen centre, so you can
        // steer by pointing at what you want to look at.
        scrollZoom: { around: 'center' },
        attributionControl: { compact: true },
      })
      mapRef.current = map
      map.scrollZoom.setZoomRate(1 / 180)

      // Rotation is the control people don't discover. MapLibre binds it to
      // right-drag and ctrl-drag only; binding plain drag would break panning,
      // so instead we surface it in the UI (the compass) and leave both native
      // bindings intact.
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
      // Natural Earth raster source that never reports ready at city zoom, so
      // 'load' can simply never fire — and the entire traffic overlay would be
      // silently missing with no error anywhere.
      map.on('style.load', () => {
        addBuildings(map)
        map.setLight?.({ anchor: 'viewport', color: '#93a3bd', intensity: 0.3 })

        if (!overlayRef.current) {
          const overlay = new MapboxOverlay({ interleaved: true, layers: [] })
          map.addControl(overlay)
          overlayRef.current = overlay
          cancelAnimationFrame(raf)
          raf = requestAnimationFrame(tick)
        }
        onMapReady?.(map)
      })

      // Debug handle. requestAnimationFrame is throttled in a backgrounded or
      // non-compositing tab, which stalls the render loop; this lets state be
      // inspected and one frame forced regardless.
      window.__mst = {
        map,
        get overlay() {
          return overlayRef.current
        },
        forceTick: () => {
          dirtyRef.current = ''
          build()
          return (overlayRef.current?._deck?.props?.layers || []).map((l) => l.id)
        },
        stats: () => ({
          styleLoaded: map.isStyleLoaded(),
          buildings: !!map.getLayer('mst-buildings'),
          camera: {
            center: map.getCenter().toArray().map((n) => +n.toFixed(5)),
            zoom: +map.getZoom().toFixed(2),
            pitch: +map.getPitch().toFixed(1),
            bearing: +map.getBearing().toFixed(1),
          },
          deckLayers: (overlayRef.current?._deck?.props?.layers || []).map((l) => l.id),
          roads: dataRef.current.roads?.length,
          signals: dataRef.current.signals?.length,
          bikeLanes: dataRef.current.bikeLanes?.length,
          frame: frameRef?.current?.header?.clock,
        }),
      }
    }

    const tick = () => {
      raf = requestAnimationFrame(tick)
      build()
    }

    /**
     * Rebuild deck layers only when something actually changed. The loop runs
     * at 60 fps but simulation state arrives at 10 Hz, so without this guard we
     * would re-upload every vertex buffer six times per new datum — waste this
     * machine cannot absorb. Camera movement still redraws: deck re-renders on
     * viewport change without needing new layer objects.
     */
    const build = () => {
      const overlay = overlayRef.current
      if (!overlay) return
      const { roads, bikeLanes } = dataRef.current
      const t = togglesRef.current
      const frame = frameRef?.current

      const key = `${frame?.header?.sim_time ?? 'x'}|${t.roads}${t.bike}`
      if (key === dirtyRef.current) return
      dirtyRef.current = key

      const layers = []

      // Real Barcelona cycle network (Open Data BCN), drawn as ground context.
      if (t.bike && bikeLanes) {
        layers.push(
          new PathLayer({
            id: 'bike-lanes',
            data: bikeLanes,
            getPath: (d) => d.path,
            getColor: [56, 214, 245, 120],
            getWidth: 2.2,
            widthUnits: 'meters',
            widthMinPixels: 1,
            widthMaxPixels: 5,
            capRounded: true,
            jointRounded: true,
            // depthTest true: buildings correctly occlude streets behind them,
            // which is most of what sells the scene as genuinely 3D.
            parameters: { depthTest: true },
          })
        )
      }

      if (t.roads && roads) {
        const cong = frame?.congestion
        layers.push(
          new PathLayer({
            id: 'roads',
            data: roads,
            getPath: (d) => d.path,
            getColor: (d, { index }) => congestionColor(cong ? cong[index] : 255, d.tier),
            getWidth: (d) => d.w,
            widthUnits: 'meters',
            widthMinPixels: 1.2,
            widthMaxPixels: 10,
            capRounded: true,
            jointRounded: true,
            parameters: { depthTest: true },
            updateTriggers: { getColor: frame?.header?.sim_time },
          })
        )
      }

      overlay.setProps({ layers })
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

/**
 * Congestion ramp on (mean speed / speed limit). Free-flowing roads sink
 * toward the basemap; jammed ones burn. Minor streets are dimmed so the
 * arterial picture reads at city zoom without turning the grid into noise.
 */
function congestionColor(v, tier) {
  const r = v / 255
  let c
  if (r > 0.72) c = [64, 84, 104]
  else if (r > 0.52) c = [70, 190, 150]
  else if (r > 0.36) c = [230, 205, 80]
  else if (r > 0.2) c = [245, 145, 55]
  else c = [240, 62, 74]

  const a = tier === 'local' ? 110 : tier === 'distributor' ? 175 : 230
  return [c[0], c[1], c[2], a]
}
