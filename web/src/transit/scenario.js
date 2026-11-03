/**
 * "If this area got a bus": cars off the road, CO2 avoided, and what the
 * centre's traffic does -- the part of the Pristina pitch no other entry has,
 * because it needs a traffic simulator.
 *
 * TWO HALVES, KEPT APART BECAUSE THEY ARE DIFFERENT KINDS OF NUMBER
 *  1. modeShift(): arithmetic on stated assumptions. Homes in the flagged area
 *     x share who drive to the centre at peak x share who would switch = cars
 *     removed. Each saved round trip is its distance (straight line x 1.3 for
 *     the street network) at a car's urban CO2 per km from city/emissions.js.
 *     Every assumption is a slider on the page with "replace with municipal
 *     data" beside it; none is presented as a fact about Pristina.
 *  2. centreEffect(): the browser simulator on Pristina's real centre, run
 *     with the fleet the page already uses and with that fleet minus the
 *     removed cars' share. Little's law turns cars per peak hour into cars in
 *     the box at once: N per hour x minutes each spends crossing it / 60.
 *     Compared per REMAINING vehicle (stopped time each, speed, CO2 per km),
 *     because total stopped time falls trivially when there are fewer cars.
 */
import { createWorld } from '../city/sim.js'
import { steadyCo2PerKm } from '../city/emissions.js'
import { proportionalPolicy } from '../city/orchestrator.js'
import { neuralPolicy } from '../city/neural.js'

export const DETOUR = 1.3          // street distance over straight line, a common urban figure
export const URBAN_KMH = 30        // speed for the per-km CO2 of the saved trips
export const CROSS_MIN = 7         // minutes a car spends in the 2.5 km centre box at peak

const R = 6371000
function metres([lat1, lon1], [lat2, lon2]) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** Cars removed at peak and CO2 avoided per weekday, from stated assumptions. */
export function modeShift({ gap, centre, driveShare, switchShare }) {
  const cars = Math.round(gap.homes * driveShare * switchShare)
  const tripKm = (metres([gap.lat, gap.lon], centre) / 1000) * DETOUR
  const kmPerDay = cars * tripKm * 2                       // there and back
  const co2KgPerDay = (kmPerDay * steadyCo2PerKm(0, URBAN_KMH)) / 1000
  return { cars, tripKm, kmPerDay, co2KgPerDay }
}

/** modeShift summed over many areas: "if every flagged area got a bus". */
export function modeShiftAll({ gaps, centre, driveShare, switchShare }) {
  const each = gaps.map((gap) => modeShift({ gap, centre, driveShare, switchShare }))
  const cars = each.reduce((s, x) => s + x.cars, 0)
  const kmPerDay = each.reduce((s, x) => s + x.kmPerDay, 0)
  return { cars, kmPerDay, co2KgPerDay: each.reduce((s, x) => s + x.co2KgPerDay, 0),
           tripKm: cars ? kmPerDay / cars / 2 : 0 }
}

/** Cars in the centre box at once that `cars` per peak hour amount to (Little's law). */
export const simultaneous = (cars, crossMin = CROSS_MIN) => (cars * crossMin) / 60
const perVehicle = (w) => {
  const m = w.metrics()
  return { stoppedS: m.stoppedVehSeconds / Math.max(1, w.fleet.length), speed: m.avgSpeedKmh,
           co2PerKm: m.co2GramsPerKm, vehicles: w.fleet.length }
}

/**
 * Run the centre with `vehicles` and with that minus the removed share, under
 * fixed timing and under the AI. Async and chunked so the page stays live.
 * Returns {base, shifted, removed} each {fixed, ai} per-vehicle metrics.
 */
export async function centreEffect(graph, { vehicles, cars, model = null, seconds = 300, seed = 7, signal }) {
  const removed = Math.min(vehicles - 30, Math.round(simultaneous(cars)))
  const run = async (n, ai) => {
    const w = createWorld(graph, { vehicles: n, seed })
    let since = 0
    for (let t = 0, k = 0; t < seconds; t += 0.25, k++) {
      w.step(0.25)
      if (ai && (since += 0.25) >= 4) { since = 0; model ? neuralPolicy(w, model) : proportionalPolicy(w) }
      if (k % 200 === 0) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        await new Promise((r) => setTimeout(r, 0))
      }
    }
    return perVehicle(w)
  }
  const base = { fixed: await run(vehicles, false), ai: await run(vehicles, true) }
  const shifted = { fixed: await run(vehicles - removed, false), ai: await run(vehicles - removed, true) }
  return { base, shifted, removed }
}

/** Percentage change, b -> a. */
export const pct = (a, b) => (b ? ((a - b) / b) * 100 : 0)

/**
 * Read the baked response (scripts/bake-transit-sim.mjs) at a removed share of
 * the fleet. Per seed, linear between measured shares (0 at share 0), then the
 * min..max across seeds -- a range, so the page can say when it spans zero.
 * Returns ranges in percent: mode (fewer cars, fixed timing), ai (signals
 * alone), both (fewer cars + signals, against today), co2 (per km, fewer cars).
 */
export function readCurve(sim, share) {
  const s = Math.max(0, Math.min(share, sim.points.at(-1).share))
  const series = { mode: [], ai: [], both: [], co2: [] }
  for (const seed of sim.seeds) {
    const runs = sim.points.map((p) => ({ share: p.share, r: p.runs.find((x) => x.seed === seed) }))
    const b = runs[0].r.base
    const ai0 = pct(b.ai.stoppedS, b.fixed.stoppedS)
    const val = {
      mode: [0, ...runs.map(({ r }) => pct(r.shifted.fixed.stoppedS, r.base.fixed.stoppedS))],
      both: [ai0, ...runs.map(({ r }) => pct(r.shifted.ai.stoppedS, r.base.fixed.stoppedS))],
      co2: [0, ...runs.map(({ r }) => pct(r.shifted.fixed.co2PerKm, r.base.fixed.co2PerKm))],
    }
    const xs = [0, ...runs.map((x) => x.share)]
    let i = 1
    while (i < xs.length - 1 && xs[i] < s) i++
    const t = (s - xs[i - 1]) / (xs[i] - xs[i - 1])
    for (const k of ['mode', 'both', 'co2']) series[k].push(val[k][i - 1] + t * (val[k][i] - val[k][i - 1]))
    series.ai.push(ai0)
  }
  const range = (v) => [Math.min(...v), Math.max(...v)]
  return { mode: range(series.mode), ai: range(series.ai), both: range(series.both), co2: range(series.co2) }
}

/** A range that crosses zero, or sits within ±tol of it, is no measurable change. */
export const noEffect = ([lo, hi], tol = 3) => (lo <= 0 && hi >= 0) || (Math.abs(lo) < tol && Math.abs(hi) < tol)
