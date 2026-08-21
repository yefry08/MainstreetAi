/**
 * Remove basemap sources that can never contribute at the zooms we use.
 *
 * Both of our basemap styles ship a low-zoom Natural Earth shaded-relief raster
 * (`ne2_shaded`, max zoom ~5). This map never goes below zoom 10, so it is
 * invisible in every possible camera position — and on some networks its host
 * does not resolve at all.
 *
 * That would be harmless except for one thing: MapLibre's `Style.loaded()`
 * stays FALSE while any source is unsettled, forever. Two real failures
 * traced back to it:
 *
 *   - `map.on('load')` never fires, so anything attached there — the entire
 *     3D layer, in our case — silently never initialises.
 *   - `setPaintProperty` throws "Style is not done loading", which would have
 *     left the buildings stuck at height 0 mid-animation.
 *
 * Pruning removes one cause, not all of them: measured after this runs, the
 * only remaining source reports loaded, yet `Style.loaded()` is still false —
 * the style's sprite is also unsettled on this network. So this is a
 * worthwhile cleanup (no repeated DNS failures, no wasted requests, less
 * console noise) but it is NOT a fix you can then rely on. The code that
 * actually keeps us correct is the defensive part: attach on `style.load`
 * rather than `load`, and treat every `setPaintProperty` as fallible.
 *
 * Deliberately generic rather than hardcoding "ne2_shaded": prune any raster
 * source whose layers top out below our minimum zoom. Vector sources are never
 * touched — those carry the buildings and streets.
 */
export function pruneUnusableSources(map) {
  const removed = { layers: [], sources: [] }
  let style
  try {
    style = map.getStyle()
  } catch {
    return removed
  }
  if (!style?.sources) return removed

  const minZoom = map.getMinZoom?.() ?? 0

  // Which raster sources are provably invisible to us?
  const doomed = new Set()
  for (const [id, src] of Object.entries(style.sources)) {
    if (src.type !== 'raster' && src.type !== 'raster-dem') continue
    const layers = (style.layers || []).filter((l) => l.source === id)
    if (!layers.length) {
      doomed.add(id)
      continue
    }
    // Only prune if EVERY layer using it is capped below our floor.
    const alwaysHidden = layers.every(
      (l) => typeof l.maxzoom === 'number' && l.maxzoom <= minZoom
    )
    if (alwaysHidden) doomed.add(id)
  }

  for (const id of doomed) {
    for (const l of (style.layers || []).filter((l) => l.source === id)) {
      try {
        map.removeLayer(l.id)
        removed.layers.push(l.id)
      } catch {
        /* already gone */
      }
    }
    try {
      map.removeSource(id)
      removed.sources.push(id)
    } catch {
      /* still referenced; leave it */
    }
  }

  return removed
}
