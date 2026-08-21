/**
 * 3D buildings: extruded OSM footprints, lit to read as volumes.
 *
 * WHY THIS WAS REBUILT
 * The first version used very dark browns (#1e1712 -> #5e4433) to protect the
 * terracotta UI accent. It worked — and killed the dimensionality. On a dark
 * ground, dark low-contrast blocks read as a texture on a plane rather than as
 * solids, so a genuinely 3D scene looked flat.
 *
 * The resolution: SATURATION is what competes with the accent, VALUE is what
 * makes a volume read. So these are lighter but no more colourful — a wider
 * lightness range across a desaturated brown. Terracotta stays the most
 * saturated thing on screen while the city gets its depth back.
 *
 * Three things do the actual work:
 *
 *   1. A wide value ramp bottom to top, plus vertical-gradient shading, so
 *      each block is darker at the street and lighter at the roof.
 *   2. A ROOF CAP — a second thin extrusion sitting in the top couple of
 *      metres of every building, in a noticeably lighter tone. A bright rim
 *      along every roofline is the single cheapest cue that something is a
 *      box and not a polygon.
 *   3. Height exaggeration. See EXAGGERATION below.
 */

const BUILDING_LAYER_ID = 'mst-buildings'
const ROOF_LAYER_ID = 'mst-roofs'
const SOURCE_ID = 'mst-bldg'

/**
 * Buildings come from OUR OWN GeoJSON, not the basemap's building layer.
 *
 * Only the OpenMapTiles schema carries per-building height, and the single
 * free key-less host serving it is a single point of failure — on conference
 * wifi it is exactly the thing that stops resolving, and the 3D city silently
 * flattens to nothing with no error anywhere. Owning the geometry means the
 * city stands up regardless of what the basemap is doing, and it works
 * offline. See sim/fetch_buildings.py.
 *
 * Coverage is the Eixample core (~2.4 x 2.7 km), which is where the demo
 * happens; the simulation extract is larger, so buildings thin out at the far
 * edges of a wide zoom-out.
 */
const SOURCE_URL = '/data/buildings.geojson'

/**
 * Heights are drawn at 1.45x true.
 *
 * This is a visualisation choice, not data: the Eixample is a near-uniform
 * plain of 6-8 storey blocks, and at the zooms a traffic view uses, true
 * heights compress into a flat crust. Exaggerating restores the skyline
 * silhouette that tells you you are looking at a city from above.
 * Nothing downstream measures buildings, so nothing is misled by it.
 */
const EXAGGERATION = 1.45

/** Thickness of the lighter roof cap, in exaggerated metres. */
const CAP = 2.6

/** Reference height at which a building counts as "tall" for the stagger. */
const TALL = 120

// `h` and `min_h` are written by sim/fetch_buildings.py; the `render_height`
// fallbacks keep this working if it is ever pointed at an OpenMapTiles source.
const RAW_HEIGHT = ['coalesce', ['get', 'h'], ['get', 'render_height'], ['get', 'height'], 12]
const HEIGHT_EXPR = ['*', RAW_HEIGHT, EXAGGERATION]
const BASE_EXPR = [
  '*',
  ['coalesce', ['get', 'min_h'], ['get', 'render_min_height'], ['get', 'min_height'], 0],
  EXAGGERATION,
]

// Desaturated brown, wide in lightness. Compare the previous ramp, which
// spanned roughly L13 -> L29; this spans L15 -> L58.
const COLOR_EXPR = [
  'interpolate',
  ['linear'],
  RAW_HEIGHT,
  0, '#241d16',
  10, '#33281e',
  20, '#413326',
  40, '#574433',
  80, '#6e5843',
  140, '#82684f',
]

// The cap is lighter than the wall it sits on at every height.
const ROOF_COLOR_EXPR = [
  'interpolate',
  ['linear'],
  RAW_HEIGHT,
  0, '#3d3125',
  10, '#52422f',
  20, '#66513c',
  40, '#7e6549',
  80, '#977a5c',
  140, '#ab8d6b',
]

export function addBuildings(map) {
  if (!map || map.getLayer(BUILDING_LAYER_ID)) return false

  const style = map.getStyle()
  if (!style?.layers) return false

  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: SOURCE_URL,
      // MapLibre tiles this in a worker; 10k polygons is comfortable.
      buffer: 64,
      tolerance: 0.4,
    })
  }
  const source = SOURCE_ID

  // Beneath the first symbol layer, so street labels stay readable at street
  // level rather than being buried inside the blocks.
  const firstSymbol = style.layers.find((l) => l.type === 'symbol')?.id

  try {
    map.addLayer(
      {
        id: BUILDING_LAYER_ID,
        source,
        type: 'fill-extrusion',
        minzoom: 12,
        paint: {
          // Added at TRUE height. The intro animation sinks the city and
          // raises it, rather than starting at zero and relying on the
          // animation to bring it up — so if anything fails, the worst case is
          // "no intro" instead of "no city". See growBuildings().
          'fill-extrusion-color': COLOR_EXPR,
          'fill-extrusion-height': HEIGHT_EXPR,
          'fill-extrusion-base': BASE_EXPR,
          'fill-extrusion-opacity': 1,
          'fill-extrusion-vertical-gradient': true,
        },
      },
      firstSymbol
    )

    map.addLayer(
      {
        id: ROOF_LAYER_ID,
        source,
        type: 'fill-extrusion',
        minzoom: 13,
        paint: {
          'fill-extrusion-color': ROOF_COLOR_EXPR,
          'fill-extrusion-height': HEIGHT_EXPR,
          // Sits in the top CAP metres. Clamped at 0 so a 1 m shed does not
          // end up with its base below ground and get discarded.
          'fill-extrusion-base': ['max', 0, ['-', HEIGHT_EXPR, CAP]],
          'fill-extrusion-opacity': 1,
          'fill-extrusion-vertical-gradient': false,
        },
      },
      firstSymbol
    )

    // Brighter and more directional than before. The extrusion light affects
    // buildings only, so this does not spill onto the streets or wash out the
    // night ground.
    // Restrained. A bright warm key light makes the stone read beautifully in
    // isolation and turns the whole city tan — at which point it stops being a
    // night scene and a field of warm brown starts competing with the one
    // terracotta accent. Volume comes from the value RANGE in the ramp above,
    // not from cranking the light.
    map.setLight?.({
      anchor: 'viewport',
      color: '#e6d8c6',
      intensity: 0.38,
      position: [1.5, 210, 35],
    })

    return true
  } catch {
    return false
  }
}

/**
 * Raise the city. Resolves when every building is at full height.
 *
 * `p` ramps 0 -> 1. A building's share of that ramp is offset by its
 * normalised height, so short blocks land first and towers arrive last.
 *
 * Driven by setTimeout rather than requestAnimationFrame: rAF is throttled to
 * zero in a backgrounded or non-compositing tab, and a stalled intro would
 * leave the city at height 0 — a blank screen mid-pitch.
 */
export function growBuildings(map, { duration = 1900, fps = 30 } = {}) {
  return new Promise((resolve) => {
    if (!map?.getLayer(BUILDING_LAYER_ID)) return resolve(false)

    /** @returns true if the paint updates actually landed. */
    const setRamp = (prog) => {
      const done = prog === 1
      const h = done ? HEIGHT_EXPR : ['*', HEIGHT_EXPR, prog]
      try {
        map.setPaintProperty(BUILDING_LAYER_ID, 'fill-extrusion-height', h)
        map.setPaintProperty(
          BUILDING_LAYER_ID,
          'fill-extrusion-base',
          done ? BASE_EXPR : ['*', BASE_EXPR, prog]
        )
        if (map.getLayer(ROOF_LAYER_ID)) {
          // The cap has to ride the same ramp or it hangs in mid-air while the
          // walls are still climbing.
          map.setPaintProperty(ROOF_LAYER_ID, 'fill-extrusion-height', h)
          map.setPaintProperty(ROOF_LAYER_ID, 'fill-extrusion-base', [
            'max', 0, ['-', h, CAP],
          ])
        }
        return true
      } catch {
        // setPaintProperty throws while the style is still loading.
        return false
      }
    }

    // Probe before committing. If we cannot drive the property right now,
    // abandon the intro and leave the city standing at full height.
    if (!setRamp(0)) return resolve(false)

    const start = performance.now()
    const step = 1000 / fps
    let timer = null
    let settled = false

    const finish = () => {
      if (settled) return
      if (timer) clearTimeout(timer)
      timer = null
      if (setRamp(1)) {
        settled = true
        return resolve(true)
      }
      // Style went busy at the last moment. Keep retrying — the alternative is
      // leaving the city underground.
      let tries = 0
      const retry = () => {
        if (settled) return
        if (setRamp(1) || ++tries > 40) {
          settled = true
          resolve(true)
        } else {
          setTimeout(retry, 150)
        }
      }
      setTimeout(retry, 150)
    }

    const frame = () => {
      const t = Math.min(1, (performance.now() - start) / duration)
      const p = 1 - Math.pow(1 - t, 3) // easeOutCubic
      if (t >= 1) return finish()

      const hn = ['min', 1, ['/', RAW_HEIGHT, TALL]]
      const prog = ['max', 0, ['min', 1, ['-', ['*', p, 1.35], ['*', 0.35, hn]]]]

      if (!setRamp(prog)) return finish()
      timer = setTimeout(frame, step)
    }

    frame()
    setTimeout(finish, duration + 900)
  })
}

export { BUILDING_LAYER_ID, ROOF_LAYER_ID, EXAGGERATION }
