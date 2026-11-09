/**
 * Turn a district's predicted traffic generators into the twin's traffic, and
 * tell the AI controller what is coming.
 *
 *   node scripts/build-events.mjs santo_domingo [--day 2] [--game] [--rain 0.5]
 *
 * Writes, beside the district's SUMO network (sim/net, gitignored):
 *   events_<district>.rou.xml   SUMO flows: cars driving to each school, office,
 *                               mall... in its arrival windows and away in its
 *                               departure windows (src/predict/generators.js).
 *                               Ids start "car" so the twin counts them as cars.
 *   forecast_<district>.json    per signal: the waves due, when, and the place
 *                               they head to or leave -- read by the AI
 *                               controller (server/controllers.py) so it can
 *                               lengthen the right greens BEFORE the wave hits.
 *
 * Both twins get the same events file: the comparison stays fair, and only the
 * AI twin is told the forecast.
 *
 * Times: the simulation starts at START_HOUR (server/sim_worker.py, 07:00), so
 * an hour h of the day is (h - START_HOUR) * 3600 simulated seconds, wrapped.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KINDS, OCCUPANCY } from '../src/predict/generators.js'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const NET = join(WEB, '..', 'sim', 'net')
const START_HOUR = 7
const args = process.argv.slice(2)
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt }
const key = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--game')) ?? 'santo_domingo'
const ORIGINS = 6            // origins per window, so a wave arrives from several directions
// The twin runs a SAMPLE of the predicted generator trips, on top of its base
// demand. At full size the Distrito Nacional's generators predict ~61,000 car
// trips in the 07:00 hour against a base demand of ~17,700/h -- part of that is
// the commute the base already carries, and the rest would take SUMO far past
// what it can run. 12% keeps the waves' SHAPE and PLACE (the colegio gate at
// 13:00, Churchill at 17:30) at a load the network can carry. The forecast page
// shows the full, unscaled prediction; the controller's forecast is scaled the
// same way as the traffic it will actually see.
const SIM_SCALE = Number(opt('scale', 0.12))
const RING = [1500, 5000]    // metres: where those cars start

const day = Number(opt('day', 2))
const game = args.includes('--game')
const rain = Number(opt('rain', 0))

const pred = JSON.parse(readFileSync(join(WEB, 'public', 'predict', `${key}.json`), 'utf8'))
const roads = JSON.parse(readFileSync(join(WEB, 'public', 'data', `roads_${key}.geojson`), 'utf8')).features
  .filter((f) => f.properties?.id && f.geometry?.coordinates?.length)
  .map((f) => { const c = f.geometry.coordinates; const m = c[Math.floor(c.length / 2)]; return { id: f.properties.id, lon: m[0], lat: m[1] } })

const metres = (a, b) => {
  const k = 111320 * Math.cos((a.lat * Math.PI) / 180)
  return Math.hypot((a.lon - b.lon) * k, (a.lat - b.lat) * 110540)
}
// Deterministic: the same generators always get the same origins.
let seed = 20261108
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)

const toSim = (h) => (((h - START_HOUR) % 24) + 24) % 24 * 3600
const flows = []
const forecast = {}
let cars = 0, gens = 0

for (const g of pred.generators) {
  const k = KINDS[g.kind]
  const on = k.days === 'all' || (k.days === 'weekdays' && day >= 1 && day <= 5) || (k.days === 'sunday' && day === 0) ||
             (k.days === 'event' && game)
  if (!on) continue
  // The gate: the nearest exported street.
  let gate = null, best = 250
  for (const r of roads) { const d = metres(g, r); if (d < best) { best = d; gate = r } }
  if (!gate) continue
  const ring = roads.filter((r) => { const d = metres(g, r); return d >= RING[0] && d <= RING[1] })
  if (ring.length < ORIGINS) continue
  gens++
  const share = Math.min(0.9, k.carShare * (1 + rain * 0.35))
  const total = ((g.people * share) / OCCUPANCY) * SIM_SCALE
  k.windows.forEach((w, wi) => {
    const dir = w.in ? 'in' : 'out'
    const [a, b] = w[dir]
    const n = total * w.share
    if (n < 1) return
    cars += n
    const vph = n / (b - a)
    // A window that straddles the simulation's start (school drop-off is
    // 06:45-07:45, the twin starts at 07:00) keeps the part from the start;
    // mapping its 06:45 begin round the clock would push the whole wave to
    // the end of the simulated day.
    const straddles = a < START_HOUR && b > START_HOUR
    const begin = straddles ? 0 : toSim(a)
    const end = straddles ? (b - START_HOUR) * 3600 : begin + (b - a) * 3600
    for (let o = 0; o < ORIGINS; o++) {
      const other = ring[Math.floor(rnd() * ring.length)]
      const [from, to] = dir === 'in' ? [other.id, gate.id] : [gate.id, other.id]
      flows.push({ id: `car_ev_${gens}_${wi}_${o}`, begin, end, vph: vph / ORIGINS, from, to })
    }
    for (const [si, wgt] of g.signals) {
      const s = pred.signals[si]
      ;(forecast[s.id] ??= []).push({ begin, end, dir, vph: Math.round(vph * wgt * 10) / 10,
                                     lat: g.lat, lon: g.lon, kind: g.kind, name: g.name })
    }
  })
}

// SUMO wants flows sorted by departure.
flows.sort((x, y) => x.begin - y.begin)
const xml = ['<?xml version="1.0" encoding="UTF-8"?>',
  `<!-- Generated by web/scripts/build-events.mjs: ${gens} generators, day ${day}${game ? ', game day' : ''}, rain ${rain}. -->`,
  '<routes>',
  ...flows.map((f) => `    <flow id="${f.id}" type="car" begin="${f.begin}" end="${f.end}" ` +
    `vehsPerHour="${f.vph.toFixed(2)}" from="${f.from}" to="${f.to}" departLane="best" departSpeed="max"/>`),
  '</routes>', ''].join('\n')
writeFileSync(join(NET, `events_${key}.rou.xml`), xml)
writeFileSync(join(NET, `forecast_${key}.json`), JSON.stringify({ district: key, day, game, rain, startHour: START_HOUR, signals: forecast }))
console.log(`events  ${key}: ${gens} generators -> ${flows.length} flows, ~${Math.round(cars)} car trips a day; ` +
            `forecast for ${Object.keys(forecast).length} signals`)
