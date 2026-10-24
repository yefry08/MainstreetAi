/**
 * Evaluation worker for training the neural signal controller.
 *
 * Speaks JSON lines on stdin/stdout so a Python trainer (training/train.py)
 * can run many of these in parallel. Each request runs controllers on the
 * ready-made cities with THE SAME sim.js and neural.js the website ships, and
 * returns the measurements. Python owns the optimisation; JavaScript owns the
 * physics; neither is ever re-implemented in the other language.
 *
 * Request:  {"id": 1, "controller": "fixed" | "proportional" | {model},
 *            "city": "madrid", "seed": 7, "seconds": 300}
 * Response: {"id": 1, "stopped": <veh-s>, "arrivals": n, "avgSpeed": kmh}
 *           or {"id": 1, "error": "..."}
 */
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CITIES, bbox, citySlug } from '../src/city/cities.js'
import { buildGraph, expandOsm } from '../src/city/osm.js'
import { createWorld } from '../src/city/sim.js'
import { proportionalPolicy } from '../src/city/orchestrator.js'
import { checkModel, neuralPolicy } from '../src/city/neural.js'

const BAKED = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'cities')
const DT = 0.25
const DECIDE_EVERY_S = 4

const graphs = new Map()
function graphFor(slug) {
  if (!graphs.has(slug)) {
    const city = CITIES.find((c) => citySlug(c) === slug)
    if (!city) throw new Error(`unknown city ${slug}`)
    const slim = JSON.parse(readFileSync(join(BAKED, `${slug}.json`), 'utf8'))
    graphs.set(slug, buildGraph(expandOsm(slim), bbox(city)))
  }
  return graphs.get(slug)
}

function run({ controller, city, seed, seconds }) {
  const g = graphFor(city)
  // Same fleet sizing as the page, so training sees the densities users see.
  const vehicles = Math.min(420, Math.max(90, Math.round(g.stats.km * 12)))
  const world = createWorld(g, { vehicles, seed })
  let decide = null
  if (controller === 'proportional') decide = () => proportionalPolicy(world)
  else if (controller && typeof controller === 'object') {
    const m = checkModel(controller)
    decide = () => neuralPolicy(world, m)
  } else if (controller !== 'fixed') throw new Error('unknown controller')

  // Every completed continuous stop, per vehicle. Total stopped time alone can
  // be cut by starving side streets -- many drivers a bit faster, a few left
  // waiting a very long time -- so the 95th-percentile wait is reported too.
  const waits = []
  const cur = new Float64Array(world.fleet.length)
  let since = 0
  for (let t = 0; t < seconds; t += DT) {
    world.step(DT)
    for (let i = 0; i < world.fleet.length; i++) {
      if (world.fleet[i].speed === 0) cur[i] += DT
      else if (cur[i] > 0) { waits.push(cur[i]); cur[i] = 0 }
    }
    if (decide) {
      since += DT
      if (since >= DECIDE_EVERY_S) { since = 0; decide() }
    }
  }
  for (const c of cur) if (c > 0) waits.push(c)
  waits.sort((a, b) => a - b)
  const m = world.metrics()
  return {
    stopped: m.stoppedVehSeconds, arrivals: m.arrivals, avgSpeed: m.avgSpeedKmh,
    p95Wait: waits.length ? waits[Math.floor(0.95 * (waits.length - 1))] : 0,
  }
}

if (process.argv.includes('--list')) {
  // The cities the trainer may use: every ready-made one that has a file.
  const out = CITIES.map(citySlug).filter((s) => {
    try { readFileSync(join(BAKED, `${s}.json`)); return true } catch { return false }
  })
  process.stdout.write(JSON.stringify(out) + '\n')
  process.exit(0)
}

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let req
  try {
    req = JSON.parse(line)
    process.stdout.write(JSON.stringify({ id: req.id, ...run(req) }) + '\n')
  } catch (e) {
    process.stdout.write(JSON.stringify({ id: req?.id ?? null, error: String(e.message || e) }) + '\n')
  }
})
