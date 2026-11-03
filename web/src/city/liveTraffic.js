/**
 * Live traffic: how congested a city's streets are right now, from TomTom.
 *
 * WHAT IT IS FOR
 * The twins otherwise run a fleet sized from street length alone, so 3 a.m.
 * and rush hour look the same. This asks TomTom's Flow Segment Data API for the
 * current and free-flow speed on the road nearest a handful of the extract's
 * signalised junctions, and sizes the fleet from how far below free flow they
 * are. The comparison (fixed timing vs AI, same fleet) is unchanged; what
 * changes is that it is run at the traffic level the city has now.
 *
 * WHAT IT IS NOT: a calibration. Fleet size from the speed ratio is a
 * monotonic rule of thumb (vehiclesFor), not a fit. The page says so.
 *
 * THE KEY is VITE_TOMTOM_KEY in web/.env.local (gitignored). It ships in the
 * bundle -- any browser-side key does -- so it must be restricted in the TomTom
 * dashboard to the site's domain. Without one, the feature is simply absent.
 */
import { toLngLat } from './geometry.js'

export const TOMTOM_KEY = import.meta.env?.VITE_TOMTOM_KEY ?? ''

const ENDPOINT = 'https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/15/json'
// Points asked per city. The free tier is 2,500 requests a day; with the cache
// below that is ~300 cities opened, comfortably more than the site sees.
const POINTS = 8
const CACHE_MS = 5 * 60 * 1000
const cache = new Map()

/** One TomTom response -> {current, free, confidence, closed} or null. */
export function parseFlow(json) {
  const f = json?.flowSegmentData
  if (!f || !(f.freeFlowSpeed > 0) || !(f.currentSpeed >= 0)) return null
  return { current: f.currentSpeed, free: f.freeFlowSpeed,
           confidence: f.confidence ?? 1, closed: !!f.roadClosure }
}

/**
 * Up to n junctions spread across the extract: farthest-point sampling, so
 * eight points are not eight corners of the same square.
 */
export function spreadPoints(points, n = POINTS) {
  if (points.length <= n) return points.slice()
  const picked = [points[0]]
  const dist = points.map((p) => Math.hypot(p.x - points[0].x, p.y - points[0].y))
  while (picked.length < n) {
    let best = 0
    for (let i = 1; i < points.length; i++) if (dist[i] > dist[best]) best = i
    const p = points[best]
    picked.push(p)
    for (let i = 0; i < points.length; i++) {
      dist[i] = Math.min(dist[i], Math.hypot(points[i].x - p.x, points[i].y - p.y))
    }
  }
  return picked
}

/**
 * Many readings -> one congestion figure: current / free-flow speed, weighted
 * by TomTom's confidence. Closed roads are left out (speed 0 there means "no
 * road", not "jam"), as are readings TomTom itself has little confidence in.
 */
export function summarise(readings) {
  const ok = readings.filter((r) => r && !r.closed && r.confidence >= 0.5)
  if (!ok.length) return null
  let w = 0, cur = 0, free = 0
  for (const r of ok) { w += r.confidence; cur += r.current * r.confidence; free += r.free * r.confidence }
  return { ratio: Math.min(1, cur / free), currentKmh: cur / w, freeKmh: free / w,
           points: ok.length, closures: readings.filter((r) => r?.closed).length }
}

/**
 * Fleet size for a congestion ratio. Free-flowing streets (ratio ~1) get 60%
 * of the street-length default; streets at half their free speed get 160%.
 * Clamped so a bad reading cannot empty the city or stall the browser.
 */
export function vehiclesFor(base, ratio) {
  const factor = Math.min(1.8, Math.max(0.6, 0.6 + 2 * (1 - ratio)))
  return Math.min(600, Math.max(60, Math.round(base * factor)))
}

/**
 * Live congestion around a city's signals. points: [{x, y}] in graph metres.
 * Returns summarise()'s result, or null when there is no key or no reading.
 * Throws only AbortError; any other failure means "no live data", not a
 * failed run.
 */
export async function liveCongestion(graph, points, { key = TOMTOM_KEY, signal, cacheKey } = {}) {
  if (!key) return null
  const hit = cacheKey && cache.get(cacheKey)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
  const readings = await Promise.all(spreadPoints(points).map(async (p) => {
    const [lon, lat] = toLngLat(graph, p.x, p.y)
    const url = `${ENDPOINT}?point=${lat.toFixed(5)},${lon.toFixed(5)}&unit=KMPH&key=${encodeURIComponent(key)}`
    try {
      const res = await fetch(url, { signal })
      return res.ok ? parseFlow(await res.json()) : null
    } catch (err) {
      if (err.name === 'AbortError') throw err
      return null
    }
  }))
  const value = summarise(readings)
  if (value) value.at = new Date()
  if (cacheKey && value) cache.set(cacheKey, { at: Date.now(), value })
  return value
}
