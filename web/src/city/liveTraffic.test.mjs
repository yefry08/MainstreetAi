/**
 * Live traffic from TomTom. Run: node src/city/liveTraffic.test.mjs
 *
 * No network: the fixture is the shape of a real Flow Segment Data response
 * (trimmed coordinates), and liveCongestion is driven through a stub fetch.
 */
import { parseFlow, spreadPoints, summarise, vehiclesFor, liveCongestion, withDeadline } from './liveTraffic.js'

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `   ${detail}` : ''}`)
  if (!ok) failures++
}

const response = (current, free, extra = {}) => ({
  flowSegmentData: {
    frc: 'FRC3', currentSpeed: current, freeFlowSpeed: free,
    currentTravelTime: 153, freeFlowTravelTime: 153, confidence: 1, roadClosure: false,
    coordinates: { coordinate: [{ latitude: 52.4015, longitude: 4.8488 }] },
    '@version': '4', ...extra,
  },
})

check('parses a real-shaped response', JSON.stringify(parseFlow(response(61, 61))) ===
  JSON.stringify({ current: 61, free: 61, confidence: 1, closed: false }))
check('rejects garbage', parseFlow({}) === null && parseFlow({ flowSegmentData: { freeFlowSpeed: 0 } }) === null)

const s = summarise([parseFlow(response(30, 60)), parseFlow(response(45, 50)),
                     parseFlow(response(0, 50, { roadClosure: true })),
                     parseFlow(response(5, 50, { confidence: 0.2 })), null])
check('closures and low-confidence readings are left out', s.points === 2 && s.closures === 1)
check('ratio is speed-weighted current/free', Math.abs(s.ratio - 75 / 110) < 1e-9, s.ratio.toFixed(3))
check('nothing usable -> null', summarise([null]) === null)

check('free flow shrinks the fleet', vehiclesFor(300, 1) === 180)
check('half speed grows it', vehiclesFor(300, 0.5) === 480)
check('fleet is clamped', vehiclesFor(420, 0) === 600 && vehiclesFor(50, 1) === 60)
check('more congestion never means fewer vehicles',
  [1, 0.9, 0.8, 0.6, 0.4, 0.2].map((r) => vehiclesFor(300, r)).every((v, i, a) => !i || v >= a[i - 1]))

const grid = []
for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) grid.push({ x: i * 50, y: j * 50 })
const pts = spreadPoints(grid, 8)
const corners = pts.filter((p) => (p.x === 0 || p.x === 950) && (p.y === 0 || p.y === 950)).length
check('spread points reach all four corners', pts.length === 8 && corners === 4)

const graph = { centre: [-58.38, -34.6], mPerLon: 91700, mPerLat: 110900 }
const urls = []
globalThis.fetch = async (url) => { urls.push(url); return { ok: true, json: async () => response(20, 40) } }
const live = await liveCongestion(graph, grid, { key: 'k', cacheKey: 'ba' })
check('asks TomTom for 8 points with lat,lon order', urls.length === 8 &&
  /point=-34\.\d{5},-58\.\d{5}&unit=KMPH&key=k$/.test(urls[0]), urls[0])
check('half speed reads as ratio 0.5', live.ratio === 0.5)
await liveCongestion(graph, grid, { key: 'k', cacheKey: 'ba' })
check('second open within 5 minutes is served from cache', urls.length === 8)
check('no key -> no requests, null', (await liveCongestion(graph, grid, { key: '' })) === null && urls.length === 8)
globalThis.fetch = async () => { throw new Error('offline') }
check('network failure -> null, not a crash', (await liveCongestion(graph, grid, { key: 'k' })) === null)

// A provider that never answers until aborted, like the 19 s hang seen live.
const hang = (signal) => new Promise((_, reject) =>
  signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
const t0 = Date.now()
const late = await withDeadline(hang, undefined, 50)
check('a hung provider times out to null, not forever', late === null && Date.now() - t0 < 1000)
const user = new AbortController()
const pending = withDeadline(hang, user.signal, 5000)
user.abort()
let threw = false
try { await pending } catch (e) { threw = e.name === 'AbortError' }
check('cancelling the run still throws AbortError', threw)

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
