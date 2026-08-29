import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { addBuildings, growBuildings, BUILDING_LAYER_ID } from './buildings'
import { pruneUnusableSources } from './pruneStyle'
import { HOME } from '../ui/CameraControls'
import { createThreeLayer } from './three/ThreeLayer'
import { createTraffic } from './three/traffic'
import { assetUrl } from '../data/assetUrl'
import { createSignals } from './three/signals'

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
 * Last resort: a style that needs no network at all.
 *
 * The two fallbacks above both fetch from somewhere. If the venue's wifi is
 * dead rather than merely slow, both fail and the map is left with an empty
 * style — and the buildings and traffic go with it, even though both are
 * LOCAL and would have rendered perfectly well. Losing the whole city because
 * the basemap could not be reached is precisely the failure the raster
 * fallback exists to prevent, arrived at one step later.
 *
 * A bare background is enough. `ensureCity` attaches our own extruded
 * buildings and the three.js traffic layer on top of whatever style is
 * current, so with this in place the demo still shows a 3D Barcelona with
 * live traffic on a completely offline machine. It loses the ground texture,
 * which is the least important thing on screen.
 */
const OFFLINE_STYLE = {
  version: 8,
  sources: {},
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0b0e15' } },
  ],
}

/**
 * The empty 3D city.
 *
 * Deliberately just the basemap, the extruded buildings and a free camera —
 * no traffic, no overlay, no data connection. This pass is about how the city
 * looks and how it feels to move through it.
 */
// Scene origin, near the middle of the simulated extract. Everything three.js
// draws is expressed in metres from here — see three/geo.js for why.
const ORIGIN = [2.1662, 41.3925]

/**
 * Features that can actually be drawn.
 *
 * The lamps were built with `gj.features.map(f => f.geometry.coordinates)`,
 * which throws on the first feature with a null geometry or missing
 * properties. That throw is caught, so nothing appears in the console -- and
 * the catch discards the ENTIRE result. One malformed feature out of 3,230
 * silently costs every traffic light in the city.
 *
 * A bad feature should cost one lamp.
 */
function usableFeatures(gj) {
  const feats = Array.isArray(gj?.features) ? gj.features : []
  const ok = feats.filter((f) => {
    const c = f?.geometry?.coordinates
    return Array.isArray(c) && c.length >= 2 &&
           Number.isFinite(c[0]) && Number.isFinite(c[1]) && f.properties
  })
  if (ok.length !== feats.length) {
    console.warn(`[signals] skipped ${feats.length - ok.length} unusable of ${feats.length}`)
  }
  return ok
}

export default function Scene({ onMapReady, onBasemapStatus, frameRef }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const grownRef = useRef(false)
  const threeRef = useRef(null)
  const trafficRef = useRef(null)
  const signalsRef = useRef(null)
  const signalDataRef = useRef(null)

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
        // Give the raster host its own chance before declaring defeat, then
        // drop to a style that cannot fail. Without this last step a dead
        // network leaves the map with an empty style and takes the buildings
        // and traffic down with it — both of which are local files that never
        // needed the network in the first place.
        fallbackWatchdog = setTimeout(() => {
          if (everLoaded) return
          onBasemapStatus?.('offline')
          try {
            map.setStyle(OFFLINE_STYLE)
            // Rebuild the city EXPLICITLY rather than waiting for a
            // `styledata` event to do it. Rebuilding is normally event-driven
            // and that is fine in the ordinary case, but this branch runs
            // precisely when the network is behaving badly, and a swap made
            // mid-load can leave the map settled with no event still to come.
            // Calling it directly is idempotent -- ensureCity returns early
            // if the buildings are already there -- so the worst case is a
            // wasted call, against a best case of not losing the city.
            setTimeout(ensureCity, 250)
            setTimeout(ensureCity, 1500)
          } catch {
            /* nothing further to fall back to */
          }
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

        // The traffic scene is a MapLibre custom layer, so it shares the map's
        // GL context and needs no camera synchronisation of its own — pan,
        // zoom, rotate and pitch keep working for free.
        if (!threeRef.current) {
          const layer = createThreeLayer({
            origin: ORIGIN,
            onInit: ({ scene, proj }) => {
              trafficRef.current = createTraffic({ scene, proj })
              // Signal geometry is fixed, so it can be built as soon as the
              // positions arrive — state colours stream in separately.
              // One lamp per APPROACH, not per junction. The server emits one
              // state byte per feature of signal_approaches.geojson in file
              // order, so these two must stay in lockstep — regenerate with
              // sim/build_signal_approaches.py. Falls back to the old junction
              // lamps if that file has not been generated; the server applies
              // the same fallback, so the two ends agree either way.
              fetch(assetUrl('data/signal_approaches.geojson'))
                .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no approaches'))))
                .then((gj) => usableFeatures(gj).map((f) => ({
                  pos: f.geometry.coordinates,
                  id: f.properties.tls,
                  label: f.properties.tls,
                  bearing: f.properties.bearing,
                  links: f.properties.links,
                })))
                .catch(() => fetch(assetUrl('data/signals.geojson'))
                  .then((r) => r.json())
                  .then((gj) => usableFeatures(gj).map((f) => ({
                    pos: f.geometry.coordinates,
                    id: f.properties.id,
                    label: f.properties.label,
                    links: f.properties.links,
                    phases: f.properties.phases,
                    corridor: f.properties.corridor,
                  }))))
                .then((pts) => {
                  signalDataRef.current = pts
                  signalsRef.current = createSignals({ scene, proj, signals: pts })
                })
                .catch(() => {
                  /* no signal geometry; traffic still renders */
                })
            },
            // Runs inside MapLibre's render pass, so vehicle positions are
            // recomputed for the frame that is about to be drawn rather than
            // one frame late.
            onFrame: () => {
              // Zoom drives how much vehicles are exaggerated: at the default
              // camera a life-sized car is 1.3 px long and the streets look
              // empty. See three/traffic.js.
              const zoom = map.getZoom()
              const lat = map.getCenter().lat
              trafficRef.current?.tick(zoom, lat)
              signalsRef.current?.update(frameRef?.current?.signals, zoom)
            },
          })
          threeRef.current = layer
          map.addLayer(layer)
        } else if (!map.getLayer('mst-three')) {
          // A style swap can drop the custom layer entirely. The three.js
          // scene object survives in threeRef, so re-attach that rather than
          // rebuilding it — rebuilding would throw away every vehicle mesh
          // and the signal geometry along with them.
          map.addLayer(threeRef.current)
        }

        // The traffic scene has to be painted AFTER the basemap and the
        // buildings, and a fallback style swap does not preserve that: the
        // replacement style's `bg` and `base` layers are inserted ON TOP of
        // the surviving custom layer. The failure is silent and thoroughly
        // misleading — the layer still renders every frame at full rate with
        // the right instance counts and the right positions, and an opaque
        // background is then painted straight over the top of it. It reads as
        // "the traffic simulation is broken" when nothing about the traffic
        // is broken at all. moveLayer with no beforeId lifts it back to the
        // top. Vehicles are not thereby drawn through walls: renderingMode
        // '3d' shares MapLibre's depth buffer, so fill-extrusion still
        // occludes anything behind it.
        if (map.getLayer('mst-three')) map.moveLayer('mst-three')

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
    // ---- render pump ------------------------------------------------------
    // Vehicles are dead-reckoned continuously, so the scene has to be redrawn
    // continuously — MapLibre otherwise only repaints when the camera moves,
    // and the traffic would freeze the moment you let go of the mouse.
    // Repaints stop when there is nothing moving, so an idle map costs nothing.
    let raf = 0
    let live = 0
    const pump = () => {
      raf = requestAnimationFrame(pump)
      const traffic = trafficRef.current
      const layer = threeRef.current
      if (!traffic || !layer) return

      const f = frameRef?.current
      if (f) {
        const n = traffic.applyFrame(f)
        if (n >= 0) live = n
      }
      if (live > 0) layer.redraw()
    }
    raf = requestAnimationFrame(pump)

    window.__mst = {
      map,

      /** Advance the scene by hand when requestAnimationFrame is throttled. */
      forceTick: (times = 1) => {
        const traffic = trafficRef.current
        if (frameRef?.current) traffic?.applyFrame(frameRef.current)
        for (let i = 0; i < times; i++) {
          traffic?.tick(map.getZoom(), map.getCenter().lat)
          signalsRef.current?.update(frameRef?.current?.signals, map.getZoom())
          map.triggerRepaint()
          try {
            map._render(0)
          } catch {
            /* mid style swap */
          }
        }
        return traffic?.stats?.() ?? null
      },

      get traffic() {
        return trafficRef.current
      },
      get signals() {
        return signalsRef.current
      },

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
        traffic: trafficRef.current?.stats?.() ?? null,
        signals: signalsRef.current?.stats?.() ?? null,
        threeLayer: !!map.getLayer('mst-three'),
        clock: frameRef?.current?.header?.clock ?? null,
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
      cancelAnimationFrame(raf)
      clearTimeout(watchdog)
      if (fallbackWatchdog) clearTimeout(fallbackWatchdog)
      trafficRef.current?.dispose?.()
      signalsRef.current?.dispose?.()
      map.remove()
      delete window.__mst
    }
  }, [onMapReady, onBasemapStatus, frameRef])

  return <div ref={containerRef} className="scene" />
}
