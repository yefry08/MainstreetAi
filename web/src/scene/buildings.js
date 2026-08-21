/**
 * 3D buildings: Barcelona sandstone, extruded from real OSM footprints, and
 * grown into place on load.
 *
 * COLOUR
 * Barcelona's Eixample really is warm sandstone, so brown is the honest
 * choice. The constraint is that #D97757 has to keep working as a UI accent
 * directly on top of it. The resolution is chroma and value, not hue: these
 * browns are genuinely brown but sit well below the accent in both saturation
 * and lightness, so terracotta stays the most saturated warm thing on screen
 * and still reads as "this is interactive" rather than "this is scenery".
 *
 * Taller blocks lighten, which gives the skyline depth without a lighting
 * model doing the work.
 *
 * MOTION
 * The city rises out of the ground once, on load. This is the one piece of
 * decorative motion in the whole app and it earns its place by doing a real
 * job: it shows the audience that these are individual buildings with
 * individual heights, not a texture. Short blocks land first and towers arrive
 * last, so the Eixample fills in as a soft wave rather than a single pop.
 *
 * It is driven by setTimeout rather than requestAnimationFrame on purpose. rAF
 * is throttled to zero in a backgrounded or non-compositing tab; if the intro
 * animation stalled there, the buildings would sit at height 0 and the city
 * would simply be missing. setTimeout keeps running, and there is a hard
 * completion guarantee at the end regardless.
 */

const BUILDING_LAYER_ID = 'mst-buildings'

/** Reference height (m) at which a building counts as "tall" for the stagger. */
const TALL = 120

const HEIGHT_EXPR = ['coalesce', ['get', 'render_height'], ['get', 'height'], 10]
const BASE_EXPR = ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0]

// Sandstone ramp. Deliberately kept below the accent in saturation.
const COLOR_EXPR = [
  'interpolate',
  ['linear'],
  HEIGHT_EXPR,
  0, '#2b211a',    // shadowed ground floors
  12, '#3d2e23',   // the Eixample's typical 6-storey block
  30, '#513c2c',
  60, '#654935',
  120, '#7a5a41',  // the few towers
]

export function addBuildings(map) {
  if (!map || map.getLayer(BUILDING_LAYER_ID)) return false

  const style = map.getStyle()
  if (!style?.layers) return false

  // Style-agnostic: find whichever source actually carries building polygons
  // rather than hard-coding a name that differs between basemaps.
  const buildingLayer = style.layers.find(
    (l) => l['source-layer'] === 'building' && l.source
  )
  const source =
    buildingLayer?.source ||
    Object.entries(style.sources || {}).find(([, s]) => s.type === 'vector')?.[0]
  if (!source) return false

  // Insert beneath the first symbol layer so street labels stay legible when
  // the camera drops to street level.
  const firstSymbol = style.layers.find((l) => l.type === 'symbol')?.id

  try {
    map.addLayer(
      {
        id: BUILDING_LAYER_ID,
        source,
        'source-layer': 'building',
        type: 'fill-extrusion',
        minzoom: 12,
        paint: {
          // Always added at TRUE height. The intro animation sinks the city
          // and raises it, rather than the layer starting at zero and relying
          // on the animation to bring it up. That ordering matters: if
          // anything downstream fails, the worst case is "no intro animation"
          // instead of "no city". See growBuildings().
          'fill-extrusion-color': COLOR_EXPR,
          'fill-extrusion-height': HEIGHT_EXPR,
          'fill-extrusion-base': BASE_EXPR,
          'fill-extrusion-opacity': 0.94,
          'fill-extrusion-vertical-gradient': true,
        },
      },
      firstSymbol
    )

    // Warm the extrusion light to match the stone. MapLibre's light affects
    // fill-extrusion only, so this does not spill onto the streets or the
    // three.js scene above them.
    map.setLight?.({ anchor: 'viewport', color: '#d8c3ad', intensity: 0.32 })

    return true
  } catch {
    // Basemap carries no building layer. Scene still works, just flat.
    return false
  }
}

/**
 * Raise the city. Resolves when every building is at full height.
 *
 * `p` ramps 0 -> 1 over `duration`. A building's own share of that ramp is
 * offset by its normalised height, so a 10 m block completes at p ≈ 0.74 while
 * a 120 m tower completes at p = 1.
 */
export function growBuildings(map, { duration = 1900, fps = 30 } = {}) {
  return new Promise((resolve) => {
    if (!map?.getLayer(BUILDING_LAYER_ID)) return resolve(false)

    /** @returns true if the paint update actually landed. */
    const setRamp = (prog) => {
      try {
        map.setPaintProperty(BUILDING_LAYER_ID, 'fill-extrusion-height',
          prog === 1 ? HEIGHT_EXPR : ['*', HEIGHT_EXPR, prog])
        // Base rides the same ramp: a raised-base building whose base briefly
        // exceeds its top gets discarded by MapLibre and flickers.
        map.setPaintProperty(BUILDING_LAYER_ID, 'fill-extrusion-base',
          prog === 1 ? BASE_EXPR : ['*', BASE_EXPR, prog])
        return true
      } catch {
        // setPaintProperty throws while the style is still loading.
        return false
      }
    }

    // Probe before committing. If we cannot drive the property right now,
    // abandon the intro entirely and leave the city standing at full height.
    // A missing animation is a cosmetic loss; a city stuck at height 0 is a
    // blank screen in the middle of a pitch.
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
      // easeOutCubic: fast out of the ground, settling gently.
      const p = 1 - Math.pow(1 - t, 3)
      if (t >= 1) return finish()

      // Per-building progress, offset by normalised height so short blocks
      // land first and towers arrive last.
      const hn = ['min', 1, ['/', HEIGHT_EXPR, TALL]]
      const prog = ['max', 0, ['min', 1, ['-', ['*', p, 1.35], ['*', 0.35, hn]]]]

      if (!setRamp(prog)) return finish()
      timer = setTimeout(frame, step)
    }

    frame()

    // Belt and braces: if the timer chain is ever starved, land the city anyway.
    setTimeout(finish, duration + 900)
  })
}

export { BUILDING_LAYER_ID, HEIGHT_EXPR }
