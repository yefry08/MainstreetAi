/**
 * Find any place on Earth by name, via OpenStreetMap's Nominatim.
 *
 * This is what turns "38 cities" into "any city". It used to be a fixed list
 * on purpose -- see cities.js -- because a free-text box that silently accepts
 * "Springfield" and then hangs on an empty Overpass query is worse than no box.
 * Geocoding first fixes that: the visitor picks from places that exist, with
 * their full name shown, before anything heavy runs. A place with too few
 * signalised junctions is still rejected later, with that reason on screen.
 *
 * NOMINATIM'S USAGE POLICY, which this follows:
 *   - at most one request per second: searches run on submit, never per
 *     keystroke, and a client-side gap enforces the rate
 *   - identify the application: the browser's Referer does that for a page;
 *     a page cannot set User-Agent
 * What is sent is the search text and nothing else.
 */
const ENDPOINT = 'https://nominatim.openstreetmap.org/search'
const MIN_GAP_MS = 1100

let lastCall = 0

export async function searchPlaces(text, { signal } = {}) {
  const q = text.trim()
  if (q.length < 2) return []

  const wait = lastCall + MIN_GAP_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCall = Date.now()

  const url = `${ENDPOINT}?format=jsonv2&limit=6&accept-language=en&q=${encodeURIComponent(q)}`
  let res
  try {
    res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  } catch (e) {
    if (e.name === 'AbortError') throw e
    throw new Error('Could not reach the place search. Check your connection.')
  }
  if (!res.ok) {
    throw new Error(res.status === 429
      ? 'The place search is rate-limited right now. Wait a few seconds and try again.'
      : `The place search answered ${res.status}.`)
  }

  const rows = await res.json()
  return rows
    .filter((r) => Number.isFinite(+r.lat) && Number.isFinite(+r.lon))
    .map((r) => {
      const parts = String(r.display_name).split(',').map((s) => s.trim())
      return {
        name: r.name || parts[0],
        country: parts[parts.length - 1],
        label: r.display_name,
        kind: r.addresstype || r.type || '',
        lat: +r.lat,
        lon: +r.lon,
        // Same extract size as the curated cities: a dense 2.4 km core carries
        // more signalised junctions than a bigger slice of suburb, and the
        // simulation scales with the area.
        km: 2.4,
        live: true,
      }
    })
}
