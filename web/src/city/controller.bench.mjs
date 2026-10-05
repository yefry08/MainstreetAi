/**
 * Does the keyless controller actually help, on real cities?
 *
 *   node src/city/controller.bench.mjs [city names...]
 *
 * Fetches each extract from Overpass exactly as the page does, builds the same
 * graph, and steps the fixed-time and proportional twins side by side for
 * 15 simulated minutes. Prints what the page would show.
 *
 * This exists because "the AI improves traffic" is a claim, and the page makes
 * it to every visitor. A bench that can say "no" is the only thing that earns
 * it -- run it before changing the controller, the deadband or the demand.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CITIES, bbox, citySlug } from './cities.js'
import { buildGraph, expandOsm } from './osm.js'
import { createTwins } from './sim.js'
import { proportionalPolicy } from './orchestrator.js'

const SIM_S = 900
const DT = 0.25
const DECIDE_EVERY_S = 4
const SEEDS = [20260904, 7, 1234]

// Ready-made cities only: the bench has to be repeatable, and live Overpass is
// neither repeatable nor reliably up. Bake first: node scripts/bake-cities.mjs
const BAKED = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'cities')
const wanted = process.argv.slice(2).map((w) => w.toLowerCase())
const pick = CITIES
  .filter((c) => existsSync(join(BAKED, `${citySlug(c)}.json`)))
  .filter((c) => !wanted.length || wanted.some((w) => citySlug(c).includes(w)))

const pct = (a, b) => (b ? ((a - b) / Math.abs(b)) * 100 : NaN)
const f = (v) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%` : '  n/a')

const rows = []
for (const city of pick) {
  process.stdout.write(`${city.name.padEnd(16)} `)
  const slim = JSON.parse(readFileSync(join(BAKED, `${citySlug(city)}.json`), 'utf8'))
  const g = buildGraph(expandOsm(slim), bbox(city))
  const vehicles = Math.min(420, Math.max(90, Math.round(g.stats.km * 12)))

  // Several seeds, because one run cannot tell an effect from noise: once a
  // single green changes, the two worlds' random routing diverges and the
  // difference between them is partly chance. Measured with one seed,
  // Istanbul came out 9.8% WORSE on the strength of one retiming -- that is
  // the noise floor talking, not the controller.
  const runs = []
  let applied = 0
  for (const seed of SEEDS) {
    const t = createTwins(g, { vehicles, seed })
    let sinceDecision = 0
    for (let s = 0; s < SIM_S; s += DT) {
      t.fixed.step(DT)
      t.ai.step(DT)
      sinceDecision += DT
      if (sinceDecision >= DECIDE_EVERY_S) {
        sinceDecision = 0
        applied += proportionalPolicy(t.ai).applied
      }
    }
    const a = t.ai.metrics()
    const b = t.fixed.metrics()
    runs.push({
      speed: pct(a.avgSpeedKmh, b.avgSpeedKmh),
      stopped: pct(a.stoppedVehSeconds, b.stoppedVehSeconds),
      arrivals: pct(a.arrivals, b.arrivals),
    })
  }
  const avg = (k) => runs.reduce((s, r) => s + r[k], 0) / runs.length
  const row = {
    city: city.name,
    signals: g.stats.signals,
    tagged: g.stats.taggedSignals,
    vehicles,
    speed: avg('speed'),
    stopped: avg('stopped'),
    arrivals: avg('arrivals'),
    stoppedRange: [Math.min(...runs.map((r) => r.stopped)), Math.max(...runs.map((r) => r.stopped))],
    retimes: Math.round(applied / SEEDS.length),
  }
  rows.push(row)
  console.log(`signals ${String(row.signals).padStart(4)}  ` +
              `avg speed ${f(row.speed).padStart(7)}  ` +
              `stopped time ${f(row.stopped).padStart(7)} ` +
              `[${f(row.stoppedRange[0])} .. ${f(row.stoppedRange[1])}]  ` +
              `crossings ${f(row.arrivals).padStart(7)}  retimes/run ${row.retimes}`)
}

if (rows.length) {
  const mean = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length
  console.log(`\nmean over ${rows.length}: avg speed ${f(mean('speed'))}, ` +
              `stopped time ${f(mean('stopped'))}, crossings ${f(mean('arrivals'))}`)
  const worse = rows.filter((r) => r.stopped > 0)
  console.log(worse.length
    ? `WORSE stopped time in: ${worse.map((r) => r.city).join(', ')}`
    : 'no city got worse on stopped time')
}
