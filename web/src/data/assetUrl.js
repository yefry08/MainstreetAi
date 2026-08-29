/**
 * Resolve a bundled asset against the page's base path.
 *
 * The 3D scene loaded everything from an absolute "/data/..." path. That works
 * at a domain root and breaks on a GitHub project page, where the site lives at
 * /MainstreetAi/ and "/data/x" resolves to the domain root -- a 404. It never
 * showed up before because the 3D scene had never been the deployed page; the
 * pixel view was, and it already used relative paths.
 *
 * The failure is quiet, which is the problem. The signal fetch has a fallback
 * chain ending in a catch, so 3,230 traffic lights simply never appeared and
 * nothing was logged. Traffic still moved, the scene looked plausible, and
 * every junction was unlit.
 *
 * Vite substitutes BASE_URL at build time -- "/" for the dev server, "./" for
 * the static bundle -- so one helper covers both.
 */
const BASE = import.meta.env?.BASE_URL ?? '/'

export function assetUrl(path) {
  const clean = String(path).replace(/^\/+/, '')
  return BASE.endsWith('/') ? `${BASE}${clean}` : `${BASE}/${clean}`
}
