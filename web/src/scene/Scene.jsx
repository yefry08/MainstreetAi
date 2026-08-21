import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { addBuildings, growBuildings, BUILDING_LAYER_ID } from './buildings'
import { pruneUnusableSources } from './pruneStyle'
import { HOME } from '../ui/CameraControls'

// Free, key-less vector tiles serving the OpenMapTiles schema, which carries
// per-building `render_height` — that is what lets us extrude real Barcelona
// footprints rather than fake a skyline. Second entry is a live fallback.
const VECTOR_STYLE = 'https://tiles.openfreemap.org/styles/dark'

/**
 * Raster fallback, defined inline rather than fetched.
 *
 * When the vector tile host is unreachable the map goes black and stays black:
 * the style parses, every layer paints, and you are left staring at a void
 * with nothing in the console to explain it. Raster tiles come from a
 * different host and a different path, so they tend to survive whatever took
 * the vector tiles down.
 *
 * It is only the ground. The buildings are ours either way, so the city still
 * stands up in 3D on top of it — the fallback loses street labels and
 * crispness, not the demo.
 */
const RASTER_FALLBACK = {
  version: 8,
  // No `glyphs` key at all — not `glyphs: null`, which is not a valid value in
  // the style spec. Raster tiles carry their labels baked in, so no font
  // stack is needed.
  sources: {
    base: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors © CARTO',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0b0e15' } },
    { id: 'base', type: 'raster', source: 'base', paint: { 'raster-opacity': 0.85 } },
  ],
}

/**
 * The empty 3D city.
 *
 * Deliberately just the basemap, the extruded buildings and a free camera —
 * no traffic, no overlay, no data connection. This pass is about how the city
 * looks and how it feels to move through it.
 */
export default function Scene({ onMapReady, onBasemapStatus }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const grownRef = useRef(false)

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: VECTOR_STYLE,
      center: HOME.center,
      zoom: HOME.zoom,
      pitch: HOME.pitch,
      bearing: HOME.bearing,
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

    // A slower zoom rate than the default. At the default, one notch of a
    // trackpad crosses several zoom levels and you lose the city entirely —
    // which matters more here than usual because there are no landmarks to
    // re-orient against on a dark basemap.
    map.scrollZoom.setZoomRate(1 / 180)
    map.dragRotate.enable()
    map.touchZoomRotate.enableRotation()

    // ---- basemap health -------------------------------------------------
    // A missing basemap is otherwise silent: the style parses, 48 layers get
    // painted, and you are left staring at a black rectangle wondering whether
    // the app is broken. It is worth knowing the difference between "no tiles"
    // and "no code".
    //
    // The first cut only swapped styles on `status >= 400`, which never fires
    // for the failure that actually happens in the field: a tile request that
    // times out has no HTTP status at all.
    let usingFallback = false
    let tileErrors = 0
    let everLoaded = false

    map.on('error', (e) => {
      // Our own GeoJSON failing is a different problem from the basemap CDN
      // failing, and must not trigger a basemap swap.
      if (e?.sourceId === 'mst-bldg') return

      const isTileFailure = Boolean(e?.sourceId)
      if (!isTileFailure && !(e?.error?.status >= 400)) return

      tileErrors++
      // A few failures could be one bad tile. A run of them is a dead host.
      if (tileErrors === 4 && !usingFallback) {
        usingFallback = true
        onBasemapStatus?.('fallback')
        map.setStyle(RASTER_FALLBACK)
        return
      }
      // Only claim "offline" if the basemap has NEVER drawn. Once tiles have
      // arrived, stray failures are individual tiles, not a dead network —
      // latching to offline there reports a blackout that isn't happening.
      if (tileErrors >= 10 && !everLoaded) onBasemapStatus?.('offline')
    })

    // A tile request that hangs never fires an error, so error counting alone
    // leaves the status pinned at "loading" indefinitely. Indefinite loading is
    // the least useful thing an instrument can say. If nothing has arrived by
    // the time this fires, the basemap is not coming.
    // A tile request that hangs never fires an error, so error counting alone
    // never trips — the map just sits black on "loading" forever. This is the
    // path that actually happens on a bad network, so the watchdog has to be
    // the thing that triggers the fallback, not just a status reporter.
    let fallbackWatchdog = null
    const watchdog = setTimeout(() => {
      if (everLoaded) return
      if (!usingFallback) {
        usingFallback = true
        onBasemapStatus?.('fallback')
        map.setStyle(RASTER_FALLBACK)
        // Give the raster host its own chance before declaring defeat.
        fallbackWatchdog = setTimeout(() => {
          if (!everLoaded) onBasemapStatus?.('offline')
        }, 12000)
      } else {
        onBasemapStatus?.('offline')
      }
    }, 9000)

    map.on('sourcedata', (e) => {
      // Our buildings loading does not mean the basemap arrived.
      if (!e?.isSourceLoaded || !e?.sourceId || e.sourceId === 'mst-bldg') return
      everLoaded = true
      tileErrors = 0
      clearTimeout(watchdog)
      if (fallbackWatchdog) clearTimeout(fallbackWatchdog)
      onBasemapStatus?.(usingFallback ? 'fallback' : 'ready')
    })

    // Attach on 'style.load', NOT 'load'. These basemaps ship a low-zoom
    // raster source that never reports ready, so `load` can simply never fire
    // and anything hung off it would silently never run.
    // setStyle() wipes every source and layer, so the city has to be rebuilt
    // afterwards. `style.load` does not reliably fire on a style REPLACEMENT
    // the way it does on first load, so this is driven from `styledata` as
    // well and made idempotent — whichever event arrives first wins, and the
    // second is a no-op. Getting this wrong means the fallback basemap comes
    // up with no buildings on it at all, which is worse than the failure it
    // was meant to rescue.
    const ensureCity = () => {
      if (!map.getStyle || map.getLayer(BUILDING_LAYER_ID)) return
      try {
        pruneUnusableSources(map)
        const added = addBuildings(map)
        if (!added) return

        // Raise the city once. Not again on a fallback swap — re-sinking the
        // skyline mid-demo because a tile host hiccuped would look like a
        // fault rather than a flourish.
        if (!grownRef.current) {
          grownRef.current = true
          growBuildings(map, { duration: 1900 })
        }
        onMapReady?.(map)
      } catch (err) {
        window.__mstLastError = String(err?.message || err)
      }
    }

    map.on('style.load', ensureCity)
    map.on('styledata', ensureCity)

    // Debug handle. requestAnimationFrame is throttled to zero in a
    // backgrounded or non-compositing tab, which stalls every animation; this
    // makes camera state inspectable regardless.
    window.__mst = {
      map,

      /**
       * Live tone controls, so building colour can be judged against a real
       * basemap and dialled in without a rebuild.
       *
       * Worth having because the two things that decide whether the city reads
       * as "night" or "daylit tan" — the light and the ramp's overall value —
       * cannot be judged with the ground missing, and the ground is exactly
       * what disappears when a tile host is unreachable.
       *
       *   __mst.light(0.3)      dimmer key light
       *   __mst.tone(0.8)       darken every building by 20%
       */
      light: (intensity = 0.38, color = '#e6d8c6') => {
        map.setLight({ anchor: 'viewport', color, intensity, position: [1.5, 210, 35] })
        return { intensity, color }
      },
      tone: (factor = 1) => {
        const scale = (hex) => {
          const n = parseInt(hex.slice(1), 16)
          const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
            .map((v) => Math.max(0, Math.min(255, Math.round(v * factor))))
          return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
        }
        for (const id of ['mst-buildings', 'mst-roofs']) {
          if (!map.getLayer(id)) continue
          const expr = map.getPaintProperty(id, 'fill-extrusion-color')
          if (!Array.isArray(expr)) continue
          map.setPaintProperty(
            id,
            'fill-extrusion-color',
            expr.map((v) => (typeof v === 'string' && v.startsWith('#') ? scale(v) : v))
          )
        }
        return factor
      },

      stats: () => ({
        styleLoaded: map.isStyleLoaded(),
        buildings: !!map.getLayer('mst-buildings'),
        sources: Object.keys(map.getStyle()?.sources ?? {}),
        camera: {
          center: map.getCenter().toArray().map((n) => +n.toFixed(5)),
          zoom: +map.getZoom().toFixed(2),
          pitch: +map.getPitch().toFixed(1),
          bearing: +map.getBearing().toFixed(1),
        },
        limits: {
          maxPitch: map.transform.maxPitch,
          minZoom: map.getMinZoom(),
          maxZoom: map.getMaxZoom(),
        },
        handlers: {
          dragPan: map.dragPan.isEnabled(),
          dragRotate: map.dragRotate.isEnabled(),
          scrollZoom: map.scrollZoom.isEnabled(),
          keyboard: map.keyboard.isEnabled(),
          touchPitch: map.touchPitch.isEnabled(),
        },
      }),
    }

    return () => {
      clearTimeout(watchdog)
      if (fallbackWatchdog) clearTimeout(fallbackWatchdog)
      map.remove()
      delete window.__mst
    }
  }, [onMapReady, onBasemapStatus])

  return <div ref={containerRef} className="scene" />
}
