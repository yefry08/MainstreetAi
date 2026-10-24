/**
 * The address bar, as state.
 *
 *   #/                         landing
 *   #/barcelona                3D Barcelona
 *   #/manhattan                3D Manhattan
 *   #/your-city                the city picker
 *   #/your-city/lima           Lima, analysed on open
 *   #/your-city/@-0.18,-78.47,Quito   any searched place, by coordinates
 *   #/how-it-works  #/research  #/contact
 *
 * WHY THIS EXISTS
 * The site had no URLs at all. Refreshing always went back to the landing
 * page, the browser's Back button left the site, and there was no way to send
 * someone "look at Lima" -- which is the single most useful thing a visitor
 * from a city's transport department could be sent.
 *
 * Hash routes because the site is static on GitHub Pages: a path like
 * /your-city/lima would 404 there, since there is no server to rewrite it to
 * index.html. Everything after # stays in the browser.
 */
const TAB_PATH = {
  landing: '', home: 'barcelona', manhattan: 'manhattan', yours: 'your-city',
  how: 'how-it-works', research: 'research', contact: 'contact',
}
const PATH_TAB = Object.fromEntries(Object.entries(TAB_PATH).map(([k, v]) => [v, k]))

export function parseHash(hash = window.location.hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const tab = PATH_TAB[parts[0] ?? ''] ?? 'landing'
  let city = null
  if (tab === 'yours' && parts[1]) {
    try { city = decodeURIComponent(parts.slice(1).join('/')) } catch { city = null }
  }
  return { tab, city }
}

export function toHash(tab, city = null) {
  const path = TAB_PATH[tab] ?? ''
  return `#/${path}${city ? `/${encodeURIComponent(city)}` : ''}`
}

/** "@lat,lon,Name" for a searched place; null for anything that is not one. */
export function parsePlaceParam(param) {
  const m = /^@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(.+)$/.exec(param ?? '')
  if (!m) return null
  const lat = +m[1]
  const lon = +m[2]
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null
  // A name from a URL is untrusted text: it is only ever rendered as text by
  // React, never as HTML, and is length-capped so a hostile link cannot fill
  // the page.
  const name = m[3].slice(0, 80)
  return { name, label: name, country: '', lat, lon, km: 2.4, live: true }
}

export const placeParam = (c) =>
  `@${c.lat.toFixed(4)},${c.lon.toFixed(4)},${c.name}`
