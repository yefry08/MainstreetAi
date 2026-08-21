/**
 * 3D building extrusion.
 *
 * The tones here are deliberately neutral-cool concrete, NOT warm stone. Real
 * Eixample facades are warm sandstone, and rendering them that way looked
 * correct in isolation but put a city-sized field of soft orange directly
 * underneath a terracotta UI accent — the accent stopped reading as an accent.
 * Grounded and slightly cool is the right call: it lets #D97757 stay the only
 * warm thing on screen, which is what makes it mean something.
 */

const BUILDING_LAYER_ID = 'mst-buildings'

export function addBuildings(map) {
  if (!map || map.getLayer(BUILDING_LAYER_ID)) return false

  const style = map.getStyle()
  if (!style?.layers) return false

  // Style-agnostic: find whichever source actually carries building polygons
  // rather than hard-coding a source name that differs between basemaps.
  const buildingLayer = style.layers.find(
    (l) => l['source-layer'] === 'building' && l.source
  )
  const source =
    buildingLayer?.source ||
    Object.entries(style.sources || {}).find(([, s]) => s.type === 'vector')?.[0]
  if (!source) return false

  // Insert beneath the first symbol layer so street labels stay on top and
  // legible when you drop the camera to street level.
  const firstSymbol = style.layers.find((l) => l.type === 'symbol')?.id

  const height = ['coalesce', ['get', 'render_height'], ['get', 'height'], 10]

  try {
    map.addLayer(
      {
        id: BUILDING_LAYER_ID,
        source,
        'source-layer': 'building',
        type: 'fill-extrusion',
        minzoom: 12,
        paint: {
          // Taller blocks read lighter, which gives the skyline depth without
          // any lighting model doing the work.
          'fill-extrusion-color': [
            'interpolate',
            ['linear'],
            height,
            0, '#1f232b',
            12, '#272c35',
            30, '#313742',
            60, '#3b424f',
            120, '#48505f',
          ],
          'fill-extrusion-height': [
            'interpolate', ['linear'], ['zoom'],
            12, 0,          // grow in as you approach, rather than popping
            13.2, height,
          ],
          'fill-extrusion-base': [
            'coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0,
          ],
          'fill-extrusion-opacity': 0.92,
          'fill-extrusion-vertical-gradient': true,
        },
      },
      firstSymbol
    )
    return true
  } catch {
    // Basemap has no building layer. The scene still works, just flat.
    return false
  }
}

export { BUILDING_LAYER_ID }
