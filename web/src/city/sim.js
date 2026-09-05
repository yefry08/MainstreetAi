/**
 * Traffic micro-simulation on a real OSM street graph, in the browser.
 *
 * WHY THIS EXISTS RATHER THAN SUMO
 * SUMO runs the Barcelona demo, and it cannot run here: it is a native binary
 * driven by a Python process, and this page is static. So the choice was a
 * simplified simulation that genuinely runs, or a canned animation that only
 * looks like one. This is the former, and the UI is explicit that it is
 * simpler than the SUMO twins rather than the same thing.
 *
 * WHAT IS REAL
 *   - the streets, their lengths, lane counts, one-way rules and speed limits
 *   - vehicles occupying and clearing specific edges, queueing at junctions
 *   - signals that hold a queue and release it
 *   - the measurements, taken from the vehicles rather than asserted
 *
 * WHAT IS SIMPLIFIED, and would be wrong to claim otherwise:
 *   - car following is a queue discipline, not a Krauss model: a vehicle moves
 *     at the edge's free speed scaled by how full the edge is
 *   - routing is a random walk weighted against U-turns, not origin-destination
 *     demand from a survey
 *   - lane changing does not exist; lanes are capacity, not geometry
 *
 * THE COMPARISON IS THE POINT, AND IT IS FAIR
 * Two worlds are stepped side by side from the same seed, carrying the same
 * vehicles on the same edges, differing only in who controls the signals. A
 * deterministic PRNG makes that reproducible: same seed, same traffic, so any
 * difference between the two is the controller and nothing else.
 */

/** Deterministic PRNG (mulberry32). Math.random cannot be seeded, and without
 *  a seed the two worlds diverge on their own and the comparison means nothing. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const GREEN = 0, AMBER = 1, RED = 2

/**
 * One world: vehicles, signals and their measurements.
 *
 * `adaptive` decides who controls the lights. Both worlds run the identical
 * fixed programme until a policy is supplied, so the comparison starts level.
 */
export function createWorld(graph, { seed = 1, vehicles = 260, adaptive = false } = {}) {
  const rand = rng(seed)
  const { edges, out } = graph

  // A signal cycles its approaches. Storing them per junction is what lets a
  // controller lengthen one approach's green without touching the others.
  // TWO PHASES, NOT ONE PER ARM.
  //
  // Giving every arm its own phase looks natural and gridlocks the network: a
  // four-way junction then holds each approach green a quarter of the time,
  // and since an edge is an approach at BOTH its ends, two junctions block it
  // independently -- around a 94% chance of being stopped somewhere. Measured:
  // zero vehicles moving.
  //
  // Real junctions run opposing arms together. Splitting the approaches into
  // two alternating groups gives each edge a ~50% duty cycle, which is what
  // lets traffic actually cross town.
  const signals = graph.signals.map((nd) => {
    const arms = (out.get(nd.id) ?? []).map((l) => l.edge)
    const groups = [[], []]
    arms.forEach((edgeIdx, i) => groups[i % 2].push(edgeIdx))
    return {
      id: nd.id, x: nd.x, y: nd.y,
      arms,
      groups,
      phase: 0,
      t: rand() * 40,                 // desynchronised, as real corridors are
      // A SPLIT, not a single green.
      //
      // With one green shared by both groups a controller can only lengthen or
      // shorten the whole cycle, never favour the busier direction -- and a
      // longer cycle adds delay to everyone. Measured on Santo Domingo, the
      // controlled twin came out 6.5% SLOWER with 21% more queue, because
      // "more green where there is more queue" could only mean "longer cycle".
      // Two greens let it move time from the empty arm to the full one at
      // constant cycle length, which is what adaptive control actually is.
      greens: [28, 28],
      amber: 3,
      state: GREEN,
    }
  })
  const signalAt = new Map(signals.map((s) => [s.id, s]))

  // What a signal is holding, keyed "edge:node" -- DIRECTIONAL.
  //
  // Keying by edge alone stops traffic at both ends of the street at once,
  // because the same edge is an approach at each of its junctions. A vehicle
  // is only held by the junction it is actually driving towards.
  let blocked = new Set()
  const holdKey = (edgeIdx, nodeId) => `${edgeIdx}:${nodeId}`

  const fleet = []
  for (let i = 0; i < vehicles; i++) {
    const e = Math.floor(rand() * edges.length)
    fleet.push({
      edge: e,
      fwd: !edges[e].oneway ? rand() < 0.5 : true,
      pos: rand() * edges[e].len,
      speed: 0,
      kind: rand() < 0.08 ? 1 : rand() < 0.14 ? 2 : 0,   // bus, bike, car
      stoppedFor: 0,
    })
  }

  // Live occupancy, so an edge slows as it fills. This is the whole of the
  // congestion model, and it is why a held green upstream shows up downstream.
  const load = new Int16Array(edges.length)

  const m = { simTime: 0, distance: 0, stoppedTime: 0, arrivals: 0, moving: 0 }

  function capacityOf(i) {
    return Math.max(2, Math.floor((edges[i].len / 7) * edges[i].lanes))
  }

  function step(dt) {
    m.simTime += dt

    // --- signals -------------------------------------------------------
    blocked = new Set()
    for (const s of signals) {
      s.t += dt
      // The phase in progress owns its own green, so cycle length is the sum
      // of the two rather than twice one of them.
      if (s.t >= s.greens[s.phase] + s.amber) {
        s.t -= s.greens[s.phase] + s.amber
        s.phase = 1 - s.phase
      }
      s.state = s.t > s.greens[s.phase] ? AMBER : GREEN
      // The group that is not holding green is stopped, and only for traffic
      // arriving AT this junction.
      const stop = s.groups[1 - s.phase] ?? []
      for (const edgeIdx of stop) blocked.add(holdKey(edgeIdx, s.id))
    }

    // --- vehicles ------------------------------------------------------
    load.fill(0)
    for (const v of fleet) load[v.edge]++

    m.moving = 0
    for (const v of fleet) {
      const e = edges[v.edge]
      const cap = capacityOf(v.edge)
      const fullness = Math.min(1, load[v.edge] / cap)

      // Free speed, cut by how full the edge is. Squared so a half-full street
      // is only mildly slower and a jammed one is properly slow.
      let target = e.speed * (1 - 0.85 * fullness * fullness)

      // Which junction this vehicle is driving towards decides who can hold it.
      const towards = v.fwd ? e.b : e.a
      const atEnd = v.pos >= e.len - 12
      if (atEnd && blocked.has(holdKey(v.edge, towards))) target = 0

      // Approach the target rather than snapping to it, so queues form and
      // discharge instead of teleporting.
      v.speed += (target - v.speed) * Math.min(1, dt * 1.8)
      if (v.speed < 0.15) v.speed = 0

      if (v.speed === 0) { v.stoppedFor += dt; m.stoppedTime += dt }
      else { v.stoppedFor = 0; m.moving++ }

      const travelled = v.speed * dt
      v.pos += travelled
      m.distance += travelled

      if (v.pos >= e.len) {
        // Cross the junction and pick the next edge.
        const node = v.fwd ? e.b : e.a
        const links = out.get(node) ?? []
        if (!links.length) {                       // dead end: turn around
          v.fwd = !v.fwd; v.pos = 0; continue
        }
        // Prefer not to double back; a random walk that U-turns freely never
        // travels anywhere and the network never actually loads.
        const onward = links.filter((l) => l.edge !== v.edge)
        const pick = (onward.length ? onward : links)[
          Math.floor(rand() * (onward.length || links.length))]
        v.edge = pick.edge
        v.fwd = pick.forward
        v.pos = 0
        m.arrivals++
      }
    }
  }

  /**
   * Queue length per signal: vehicles held at the stop line right now.
   * This is what the controller sees, and the only thing it sees.
   */
  function queues() {
    // Per GROUP, not just per junction. A controller that only knows the total
    // cannot tell which side to give time to, which is the one decision it is
    // being asked to make.
    const q = new Map(signals.map((s) => [s.id, { total: 0, byGroup: [0, 0] }]))
    for (const v of fleet) {
      if (v.speed > 0.15 || v.pos < edges[v.edge].len - 14) continue
      const e = edges[v.edge]
      const node = v.fwd ? e.b : e.a
      const entry = q.get(node)
      if (!entry) continue
      entry.total++
      const s = signalAt.get(node)
      if (s) entry.byGroup[s.groups[0].includes(v.edge) ? 0 : 1]++
    }
    return q
  }

  /**
   * Apply a controller policy: a green split per signal, clamped.
   *
   * Accepts [g0, g1] for the two groups, or a single number read as "same for
   * both" -- which only changes cycle length and is almost never what is
   * wanted. The band keeps a controller a controller: 5s greens strand
   * everyone and 90s greens are a long fixed programme under another name.
   */
  function applyPolicy(policy) {
    if (!policy) return 0
    const clamp = (v) => Math.max(8, Math.min(55, v))
    let applied = 0
    for (const [id, value] of Object.entries(policy)) {
      const s = signalAt.get(Number(id)) ?? signalAt.get(id)
      if (!s) continue
      const pair = Array.isArray(value) ? value : [value, value]
      const g0 = Number(pair[0])
      const g1 = Number(pair[1])
      if (!Number.isFinite(g0) || !Number.isFinite(g1)) continue
      s.greens = [clamp(g0), clamp(g1)]
      applied++
    }
    return applied
  }

  return {
    step, queues, applyPolicy, signals, fleet, edges, load,
    adaptive,
    metrics: () => ({
      simTime: m.simTime,
      // Time-averaged across the fleet: total distance over vehicle-seconds.
      // Distinct from meanSpeedKmh below, which is the instantaneous mean --
      // the average is what a journey feels like, the instantaneous is what
      // the screen shows.
      avgSpeedKmh: m.simTime > 0 && fleet.length
        ? (m.distance / (m.simTime * fleet.length)) * 3.6 : 0,
      meanSpeedKmh: fleet.length
        ? (fleet.reduce((s, v) => s + v.speed, 0) / fleet.length) * 3.6 : 0,
      stoppedVehSeconds: m.stoppedTime,
      moving: m.moving,
      queued: fleet.length - m.moving,
      arrivals: m.arrivals,
      vehicles: fleet.length,
    }),
  }
}

/**
 * The pair. Same seed, same fleet, same streets -- only the controller differs.
 */
export function createTwins(graph, opts = {}) {
  const seed = opts.seed ?? 20260904
  return {
    fixed: createWorld(graph, { ...opts, seed, adaptive: false }),
    ai: createWorld(graph, { ...opts, seed, adaptive: true }),
  }
}

/** Percent improvement of the AI world over fixed-time, on the shared metrics. */
export function compare(twins) {
  const a = twins.ai.metrics()
  const b = twins.fixed.metrics()
  const pct = (x, y, upIsGood) => {
    if (!y) return null
    const d = ((x - y) / Math.abs(y)) * 100
    return { value: d, good: upIsGood ? d > 0 : d < 0 }
  }
  return {
    ai: a,
    fixed: b,
    speed: pct(a.meanSpeedKmh, b.meanSpeedKmh, true),
    stopped: pct(a.stoppedVehSeconds, b.stoppedVehSeconds, false),
    queued: pct(a.queued, b.queued, false),
    arrivals: pct(a.arrivals, b.arrivals, true),
  }
}
