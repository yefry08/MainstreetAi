import { assetUrl } from '../data/assetUrl'
import { bbox, citySlug } from './cities'
import { fetchCity, expandOsm } from './osm'

/**
 * Streets for a city: the ready-made copy if the site has one, live Overpass
 * otherwise.
 *
 * The ready-made path is tried for every curated city and silently falls
 * through on any failure -- a missing file, a dev server answering a missing
 * path with index.html (200, not JSON), a format bump. The live path is always
 * correct, just slower and less reliable, so falling back to it can never show
 * the wrong city; it can only be slower.
 *
 * `source` is returned so the page can say which one it used. A visitor
 * waiting thirty seconds deserves to know it is because their city is being
 * fetched live, not because the site is broken.
 */
export async function loadStreets(city, { signal, onProgress } = {}) {
  if (!city.live) {
    try {
      const res = await fetch(assetUrl(`cities/${citySlug(city)}.json`), { signal })
      if (res.ok) return { osm: expandOsm(await res.json()), source: 'ready-made' }
    } catch (e) {
      if (e.name === 'AbortError') throw e
    }
  }
  return { osm: await fetchCity(bbox(city), { signal, onProgress }), source: 'live' }
}
