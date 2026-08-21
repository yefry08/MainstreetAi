import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { addBuildings, growBuildings } from './buildings'
import { pruneUnusableSources } from './pruneStyle'
import { HOME } from '../ui/CameraControls'

// Free, key-less vector tiles serving the OpenMapTiles schema, which carries
// per-building `render_height` — that is what lets us extrude real Barcelona
// footprints rather than fake a skyline. Second entry is a live fallback.
const STYLES = [
  'https://tiles.openfreemap.org/styles/dark',
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
]

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
      style: STYLES[0],
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
    let styleIdx = 0
    let tileErrors = 0

    map.on('error', (e) => {
      const isTileFailure = Boolean(e?.sourceId)
      const status = e?.error?.status

      if (isTileFailure || status >= 400) {
        tileErrors++
        // A few failures could be one bad tile. A run of them is a dead CDN.
        if (tileErrors === 4 && styleIdx === 0) {
          styleIdx = 1
          onBasemapStatus?.('fallback')
          map.setStyle(STYLES[1])
          return
        }
        if (tileErrors >= 10) onBasemapStatus?.('offline')
      }
    })

    // A tile request that hangs never fires an error, so error counting alone
    // leaves the status pinned at "loading" indefinitely. Indefinite loading is
    // the least useful thing an instrument can say. If nothing has arrived by
    // the time this fires, the basemap is not coming.
    let everLoaded = false
    const watchdog = setTimeout(() => {
      if (!everLoaded) onBasemapStatus?.('offline')
    }, 15000)

    map.on('sourcedata', (e) => {
      if (e?.isSourceLoaded && e?.sourceId) {
        everLoaded = true
        tileErrors = 0
        clearTimeout(watchdog)
        onBasemapStatus?.('ready')
      }
    })

    // Attach on 'style.load', NOT 'load'. These basemaps ship a low-zoom
    // raster source that never reports ready, so `load` can simply never fire
    // and anything hung off it would silently never run.
    map.on('style.load', () => {
      pruneUnusableSources(map)
      addBuildings(map)

      // Raise the city once, on first load. Not on the fallback style swap —
      // re-sinking the skyline mid-demo because a tile host hiccuped would
      // look like a fault.
      if (!grownRef.current) {
        grownRef.current = true
        growBuildings(map, { duration: 1900 })
      }
      onMapReady?.(map)
    })

    // Debug handle. requestAnimationFrame is throttled to zero in a
    // backgrounded or non-compositing tab, which stalls every animation; this
    // makes camera state inspectable regardless.
    window.__mst = {
      map,
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
      map.remove()
      delete window.__mst
    }
  }, [onMapReady, onBasemapStatus])

  return <div ref={containerRef} className="scene" />
}
