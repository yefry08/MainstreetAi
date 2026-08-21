import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { ScatterplotLayer, PathLayer } from '@deck.gl/layers'
import { CARS, BUSES, BIKES, congestionColor } from './theme'

// Free, key-less vector tiles. OpenFreeMap serves the OpenMapTiles schema,
// which carries per-building `render_height` -- that is what lets us extrude
// real Barcelona building footprints instead of faking a skyline.
const STYLES = [
  'https://tiles.openfreemap.org/styles/dark',
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
]

const INITIAL = {
  center: [2.1662, 41.3907], // Eixample, just north of Plaça Catalunya
  zoom: 14.1,
  pitch: 58,
  bearing: -18,
}

export default function MapView({ frameRef, onPickSignal, layerToggles }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const overlayRef = useRef(null)
  const dataRef = useRef({ roads: null, signals: null })
  const togglesRef = useRef(layerToggles)
  togglesRef.current = layerToggles

  // scratch buffers, reallocated only when the vehicle count grows
  const bufRef = useRef({ pos: null, col: null, rad: null, cap: 0 })
  const dirtyRef = useRef('')

  useEffect(() => {
    let cancelled = false
    let raf

    const boot = async () => {
      // ---- load the static geometry we exported from the SUMO network ----
      // bike_lanes is the City of Barcelona's own published network, so it is
      // optional: if the fetch script has not been run it simply is not drawn.
      const [roads, signals, bikeLanes] = await Promise.all([
        fetch('/data/roads.geojson').then((r) => r.json()),
        fetch('/data/signals.geojson').then((r) => r.json()),
        fetch('/data/bike_lanes.geojson')
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ])
      if (cancelled) return

      dataRef.current.bikeLanes =
        bikeLanes?.features?.map((f) => ({
          path: f.geometry.coordinates,
          name: f.properties.name,
        })) || null

      dataRef.current.roads = roads.features.map((f) => ({
        path: f.geometry.coordinates,
        w: f.properties.w,
        tier: f.properties.tier,
        name: f.properties.name,
        corridor: f.properties.corridor,
      }))
      dataRef.current.signals = signals.features.map((f) => ({
        pos: f.geometry.coordinates,
        id: f.properties.id,
        label: f.properties.label,
        links: f.properties.links,
        phases: f.properties.phases,
        corridor: f.properties.corridor,
      }))

      // ---- basemap ----
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: STYLES[0],
        ...INITIAL,
        antialias: true,
        maxPitch: 72,
        attributionControl: { compact: true },
      })
      mapRef.current = map

      // Debug handle, attached at construction so it exists even if the map
      // never gets a paint (a background tab throttles requestAnimationFrame,
      // which stalls MapLibre's load event).
      window.__bcn = {
        map,
        get overlay() { return overlayRef.current },
        // Runs exactly one frame of the render loop. Lets you verify layer
        // construction in an environment where requestAnimationFrame is
        // throttled (a background tab, or a headless check).
        forceTick: () => {
          buildLayers()
          return (overlayRef.current?._deck?.props?.layers || []).map((l) => l.id)
        },
        stats: () => ({
          styleLoaded: map.isStyleLoaded(),
          mapLoaded: map.loaded(),
          buildings: !!map.getLayer('bcn-3d-buildings'),
          deckLayers: (overlayRef.current?._deck?.props?.layers || []).map((l) => l.id),
          roads: dataRef.current.roads?.length,
          signals: dataRef.current.signals?.length,
          frame: frameRef.current?.header?.clock,
          vehicles: frameRef.current?.header?.n_veh,
        }),
      }

      let styleIdx = 0
      map.on('error', (e) => {
        // If OpenFreeMap is unreachable during the demo, silently fall back.
        if (styleIdx === 0 && e?.error?.status >= 400) {
          styleIdx = 1
          map.setStyle(STYLES[1])
        }
      })

      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right')

      // Attach on 'style.load', NOT on 'load'. The 'load' event waits for every
      // source in the style to report ready, and these basemaps carry a
      // low-zoom Natural Earth raster that never settles at city zoom -- so
      // 'load' can simply never fire, and the whole traffic overlay would be
      // silently missing. 'style.load' is the event that actually guarantees
      // what we need: a style we can insert layers into.
      map.on('style.load', () => {
        addBuildings(map)
        map.setLight?.({ anchor: 'viewport', color: '#8ea6c8', intensity: 0.28 })

        if (!overlayRef.current) {
          const overlay = new MapboxOverlay({ interleaved: true, layers: [] })
          map.addControl(overlay)
          overlayRef.current = overlay
          cancelAnimationFrame(raf)
          raf = requestAnimationFrame(tick)
        }
      })
    }

    // ---- the render loop, driven by rAF rather than React ----
    const tick = () => {
      raf = requestAnimationFrame(tick)
      buildLayers()
    }

    const buildLayers = () => {
      const overlay = overlayRef.current
      const frame = frameRef.current
      if (!overlay || !frame) return

      const { roads, signals, bikeLanes } = dataRef.current
      const t = togglesRef.current

      // The loop runs at 60 fps but simulation state only changes 10 times a
      // second. Without this guard we would rebuild 2,500 vehicle vertices and
      // re-upload them to the GPU on every frame, six times more often than
      // there is new data -- which is exactly the kind of waste a low-power
      // demo machine cannot absorb. Panning still redraws: deck.gl re-renders
      // on viewport change without needing new layer objects.
      const key = `${frame.header.sim_time}|${t.vehicles}${t.roads}${t.signals}${t.bike}`
      if (key === dirtyRef.current) return
      dirtyRef.current = key

      const layers = []

      // ---------- real Barcelona cycle network (Open Data BCN) ----------
      // Drawn under the congestion overlay: it is context for the mode-shift
      // argument, not live simulation state.
      if (t.bike && bikeLanes) {
        layers.push(
          new PathLayer({
            id: 'bike-lanes',
            data: bikeLanes,
            getPath: (d) => d.path,
            getColor: [60, 214, 245, 130],
            getWidth: 2.4,
            widthUnits: 'meters',
            widthMinPixels: 1,
            widthMaxPixels: 5,
            capRounded: true,
            jointRounded: true,
            parameters: { depthTest: false },
          })
        )
      }

      // ---------- congestion overlay on the arterial network ----------
      if (t.roads && roads) {
        const cong = frame.congestion
        layers.push(
          new PathLayer({
            id: 'roads',
            data: roads,
            getPath: (d) => d.path,
            getColor: (d, { index }) =>
              congestionColor(cong ? cong[index] : 255, d.tier),
            getWidth: (d) => d.w,
            widthUnits: 'meters',
            widthMinPixels: 1.1,
            widthMaxPixels: 9,
            capRounded: true,
            jointRounded: true,
            opacity: 0.95,
            parameters: { depthTest: false },
            updateTriggers: { getColor: frame.header.sim_time },
          })
        )
      }

      // ---------- vehicles ----------
      const veh = frame.vehicles
      if (t.vehicles && veh && veh.length) {
        const n = veh.length / 5
        const b = bufRef.current
        if (b.cap < n) {
          b.cap = Math.ceil(n * 1.4)
          b.pos = new Float32Array(b.cap * 2)
          b.col = new Uint8Array(b.cap * 4)
          b.rad = new Float32Array(b.cap)
        }
        for (let i = 0; i < n; i++) {
          const o = i * 5
          b.pos[i * 2] = veh[o]
          b.pos[i * 2 + 1] = veh[o + 1]
          const kind = veh[o + 3]
          const speed = veh[o + 4]
          const pal = kind === 1 ? BUSES : kind === 2 ? BIKES : CARS
          // Stopped vehicles glow hot: that is the delay you are watching the
          // AI remove, so it should be the most visible thing on the map.
          const stuck = speed < 0.6
          const c = stuck ? pal.stopped : pal.moving
          const j = i * 4
          b.col[j] = c[0]
          b.col[j + 1] = c[1]
          b.col[j + 2] = c[2]
          b.col[j + 3] = stuck ? 255 : 215
          // Radii in metres, sized for legibility on a projector rather than
          // for physical accuracy: a bus has to read as a bus at city zoom.
          b.rad[i] = kind === 1 ? 11 : kind === 2 ? 4 : 5.5
        }

        layers.push(
          new ScatterplotLayer({
            id: 'vehicles',
            data: {
              length: n,
              attributes: {
                getPosition: { value: b.pos, size: 2 },
                getFillColor: { value: b.col, size: 4, normalized: true },
                getRadius: { value: b.rad, size: 1 },
              },
            },
            radiusUnits: 'meters',
            radiusMinPixels: 2.2,
            radiusMaxPixels: 14,
            stroked: false,
            parameters: { depthTest: false },
          })
        )
      }

      // ---------- traffic signals ----------
      if (t.signals && signals && frame.signals) {
        const sig = frame.signals
        layers.push(
          new ScatterplotLayer({
            id: 'signals',
            data: signals,
            getPosition: (d) => d.pos,
            getFillColor: (d, { index }) => {
              const s = sig[index]
              return s === 2 ? [46, 230, 168, 210]
                : s === 1 ? [255, 200, 60, 220]
                : [255, 72, 92, 190]
            },
            getRadius: (d) => 6 + Math.min(d.links, 24) * 0.35,
            radiusUnits: 'meters',
            radiusMinPixels: 2,
            radiusMaxPixels: 11,
            stroked: false,
            pickable: true,
            onClick: (info) => info.object && onPickSignal(info.object),
            parameters: { depthTest: false },
            updateTriggers: { getFillColor: frame.header.sim_time },
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
    }
  }, [frameRef, onPickSignal])

  return <div ref={containerRef} className="map" />
}

/** Extrude the basemap's building footprints. */
function addBuildings(map) {
  const style = map.getStyle()
  if (!style?.sources) return
  if (map.getLayer('bcn-3d-buildings')) return

  // Style-agnostic: find whichever vector source actually carries buildings.
  const candidates = Object.entries(style.sources)
    .filter(([, s]) => s.type === 'vector')
    .map(([id]) => id)
  const withBuilding = style.layers?.find(
    (l) => l['source-layer'] === 'building' && l.source
  )
  const source = withBuilding?.source || candidates[0]
  if (!source) return

  // Insert below the first symbol layer so street labels stay readable.
  const firstSymbol = style.layers?.find((l) => l.type === 'symbol')?.id

  try {
    map.addLayer(
      {
        id: 'bcn-3d-buildings',
        source,
        'source-layer': 'building',
        type: 'fill-extrusion',
        minzoom: 12.5,
        paint: {
          'fill-extrusion-color': [
            'interpolate', ['linear'],
            ['coalesce', ['get', 'render_height'], ['get', 'height'], 12],
            0, '#161d29', 30, '#1e2836', 90, '#2a3648',
          ],
          'fill-extrusion-height': [
            'coalesce', ['get', 'render_height'], ['get', 'height'], 12,
          ],
          'fill-extrusion-base': [
            'coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0,
          ],
          'fill-extrusion-opacity': 0.88,
        },
      },
      firstSymbol
    )
  } catch {
    /* style has no building layer; the map still works, just flat */
  }
}
