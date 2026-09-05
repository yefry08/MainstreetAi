/**
 * Unit tests for the browser traffic simulation.
 *
 * The property that matters most is FAIRNESS. Two worlds are stepped side by
 * side and the difference between them is presented to a visitor as the effect
 * of the controller. That claim is only true if everything else is identical,
 * so the first tests here assert that two worlds from the same seed stay
 * byte-for-byte identical while neither is being controlled. If that ever
 * breaks, every number the feature reports becomes noise and nothing on screen
 * would look wrong.
 *
 * The rest pin the things a queue-discipline model gets wrong quietly:
 * vehicles leaking off the ends of edges, signals blocking every approach at
 * once, and a policy being applied outside the band that keeps a controller a
 * controller.
 */

import { createWorld, createTwins, compare } from './sim.js'

let failures = 0
const check = (name, ok, detail) => {
  if (!ok) failures++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '   ' + detail : ''}`)
}

/** A small synthetic grid, so the tests do not depend on a network fetch. */
function grid(n = 4, spacing = 120) {
  const nodes = new Map()
  const edges = []
  const id = (r, c) => r * n + c
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      nodes.set(id(r, c), { id: id(r, c), x: c * spacing, y: r * spacing, signal: false, deg: 0 })
    }
  }
  const link = (a, b) => {
    const A = nodes.get(a), B = nodes.get(b)
    edges.push({ a, b, pts: [[A.x, A.y], [B.x, B.y]], len: spacing,
                 oneway: false, lanes: 2, speed: 11.1 })
    A.deg++; B.deg++
  }
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (c + 1 < n) link(id(r, c), id(r, c + 1))
      if (r + 1 < n) link(id(r, c), id(r + 1, c))
    }
  }
  const out = new Map()
  edges.forEach((e, i) => {
    if (!out.has(e.a)) out.set(e.a, [])
    if (!out.has(e.b)) out.set(e.b, [])
    out.get(e.a).push({ edge: i, to: e.b, forward: true })
    out.get(e.b).push({ edge: i, to: e.a, forward: false })
  })
  for (const nd of nodes.values()) if (nd.deg >= 3) nd.signal = true
  const signals = [...nodes.values()].filter((nd) => nd.signal)
  return { nodes, edges, out, signals }
}

const G = grid()
const run = (w, steps = 400, dt = 0.25) => { for (let i = 0; i < steps; i++) w.step(dt) }
const snapshot = (w) => w.fleet.map((v) => `${v.edge}:${v.pos.toFixed(4)}:${v.speed.toFixed(4)}`).join('|')

console.log('sim: the comparison is only worth anything if the worlds start identical')

// --- FAIRNESS: the property the whole feature rests on --------------------
{
  const a = createWorld(G, { seed: 7, vehicles: 60 })
  const b = createWorld(G, { seed: 7, vehicles: 60 })
  check('same seed produces an identical starting fleet', snapshot(a) === snapshot(b))
  run(a); run(b)
  check('same seed stays identical after 400 steps', snapshot(a) === snapshot(b),
        'if this drifts, every reported difference is noise')
}
{
  const a = createWorld(G, { seed: 7, vehicles: 60 })
  const b = createWorld(G, { seed: 8, vehicles: 60 })
  check('a different seed produces different traffic', snapshot(a) !== snapshot(b),
        'otherwise the seed is not doing anything')
}
{
  const t = createTwins(G, { vehicles: 60 })
  run(t.fixed); run(t.ai)
  check('untouched twins are identical (the controller is the only variable)',
        snapshot(t.fixed) === snapshot(t.ai))
}

// --- vehicles stay on the network -----------------------------------------
{
  const w = createWorld(G, { seed: 3, vehicles: 120 })
  run(w, 800)
  const onNetwork = w.fleet.every((v) =>
    v.edge >= 0 && v.edge < G.edges.length && v.pos >= 0 && v.pos <= G.edges[v.edge].len + 1e-6)
  check('no vehicle leaves its edge', onNetwork)
  const finite = w.fleet.every((v) => Number.isFinite(v.pos) && Number.isFinite(v.speed))
  check('no position or speed goes non-finite', finite)
  const nonNegative = w.fleet.every((v) => v.speed >= 0)
  check('no vehicle drives backwards', nonNegative)
}

// --- signals hold traffic, and do not hold all of it ----------------------
{
  const w = createWorld(G, { seed: 5, vehicles: 100 })
  check('the grid has signalised junctions', w.signals.length > 0, `${w.signals.length}`)
  const oneGreen = w.signals.every((s) => s.arms.length === 0 || s.groups.length === 2)
  check('every signal has two alternating groups', oneGreen)
  run(w, 600)
  const m = w.metrics()
  check('traffic actually moves', m.arrivals > 0, `${m.arrivals} junction crossings`)
  check('some traffic queues at lights', m.stoppedVehSeconds > 0,
        `${m.stoppedVehSeconds.toFixed(0)} veh-s`)
  // Deliberately a fraction, not "> 0". The first version of this asserted
  // only that something moved, and passed on a network with 5 of 100 vehicles
  // crawling -- effectively gridlock, reported as a pass.
  check('a healthy share of the fleet is moving',
        m.moving > m.vehicles * 0.35, `${m.moving} de ${m.vehicles}`)
  check('mean speed is not floor-zero',
        m.meanSpeedKmh > 3, `${m.meanSpeedKmh.toFixed(2)} km/h`)
}

// --- the metrics are arithmetic, not assertions ---------------------------
{
  const w = createWorld(G, { seed: 11, vehicles: 80 })
  run(w, 400)
  const m = w.metrics()
  check('moving + queued equals the fleet', m.moving + m.queued === m.vehicles,
        `${m.moving}+${m.queued} vs ${m.vehicles}`)
  check('the network is not gridlocked', m.moving > m.vehicles * 0.35,
        `${m.moving} de ${m.vehicles} en movimiento`)
  check('average speed is finite and sane',
        Number.isFinite(m.avgSpeedKmh) && m.avgSpeedKmh >= 0 && m.avgSpeedKmh < 200,
        `${m.avgSpeedKmh.toFixed(2)} km/h`)
  check('mean speed is finite, sane and non-zero',
        Number.isFinite(m.meanSpeedKmh) && m.meanSpeedKmh > 3 && m.meanSpeedKmh < 200,
        `${m.meanSpeedKmh.toFixed(2)} km/h`)
  check('sim time advances with dt', Math.abs(m.simTime - 100) < 1e-6, `${m.simTime}`)
}

// --- the policy band: a controller, not a free hand -----------------------
{
  const w = createWorld(G, { seed: 2, vehicles: 40 })
  const first = w.signals[0]
  w.applyPolicy({ [first.id]: [2, 900] })
  check('an absurdly short green is clamped up', first.greens[0] >= 8, `${first.greens[0]}s`)
  check('an absurdly long green is clamped down', first.greens[1] <= 55, `${first.greens[1]}s`)
  w.applyPolicy({ [first.id]: [34, 20] })
  check('a sane split is applied as given',
        first.greens[0] === 34 && first.greens[1] === 20, first.greens.join('/'))
  // The whole point of a split: favour one side at constant cycle length.
  check('a split can be asymmetric', first.greens[0] !== first.greens[1])
  w.applyPolicy({ [first.id]: 30 })
  check('a bare number is read as both groups',
        first.greens[0] === 30 && first.greens[1] === 30)
  const before = first.greens.join('/')
  w.applyPolicy({ [first.id]: ['x', 'y'] })
  check('a non-numeric split is ignored, not coerced', first.greens.join('/') === before)
  check('an unknown junction id is ignored', w.applyPolicy({ 999999: 30 }) === 0)
  check('a null policy is a no-op', w.applyPolicy(null) === 0)
}

// --- queues are what the controller sees ----------------------------------
{
  const w = createWorld(G, { seed: 9, vehicles: 150 })
  run(w, 500)
  const q = w.queues()
  check('queues are reported per signal', q.size === w.signals.length)
  const total = [...q.values()].reduce((s, e) => s + e.total, 0)
  check('queue counts are non-negative integers',
        [...q.values()].every((e) => Number.isInteger(e.total) && e.total >= 0))
  check('each queue is split across the two groups',
        [...q.values()].every((e) => e.byGroup[0] + e.byGroup[1] === e.total),
        'a controller blind to which side is busy cannot choose a split')
  check('the queue total never exceeds the fleet', total <= w.fleet.length,
        `${total} of ${w.fleet.length}`)
}

// --- compare() reports a direction, not just a number ---------------------
{
  const t = createTwins(G, { vehicles: 100 })
  run(t.fixed, 300); run(t.ai, 300)
  const c = compare(t)
  check('compare returns both sides', !!c.ai && !!c.fixed)
  check('identical twins show no speed difference',
        c.speed === null || Math.abs(c.speed.value) < 1e-9,
        'nothing has been controlled yet, so there is nothing to differ')
}

console.log(`\n${failures === 0 ? 'all passed' : `${failures} FAILED`}`)
process.exit(failures ? 1 : 0)
