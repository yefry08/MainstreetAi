/**
 * The AI half: a palette for the city, and a signal policy for its traffic.
 *
 * These are the two things a language model is genuinely good at here, and the
 * prompts are written to keep it inside them. It is not asked to invent
 * geometry -- OpenStreetMap supplies that -- and it is not asked to drive
 * vehicles. It reads queue lengths and returns green times, which is the same
 * job the Barcelona orchestrator does against SUMO.
 *
 * EVERY REPLY IS TREATED AS UNTRUSTED
 * A model can return prose, malformed JSON, junction ids that do not exist,
 * or green times of nine hundred seconds. All of that is normal, none of it
 * should break a running simulation, and applyPolicy() clamps what survives
 * parsing. The failure mode to avoid is a bad reply stopping the scene: if a
 * policy cannot be used the simulation simply keeps its current timings.
 */

import { complete, parseJson } from './ai.js'

const PALETTE_SYSTEM = `You are an art director specialising in urban visual identity.
Reply ONLY with valid JSON, no surrounding text.`

/**
 * The city's colours. This is the "use the colour that best represents the
 * city" step, and it is the one place a model's cultural knowledge does real
 * work that data cannot.
 */
export async function cityPalette(provider, key, model, city, signal) {
  const user = `City: ${city.name}, ${city.country}.

Choose a palette that visually represents this city: its light, its building
materials, its climate and its character. Do not use generic colours.

Return exactly this JSON:
{
  "ground": "#rrggbb",
  "roads": "#rrggbb",
  "buildings": "#rrggbb",
  "accent": "#rrggbb",
  "sky": "#rrggbb",
  "reason": "one sentence on why these colours represent the city"
}`

  const out = await complete(provider, key, {
    model, system: PALETTE_SYSTEM, user, maxTokens: 400, signal,
  })
  const raw = parseJson(out)

  // A model that returns "dark blue" instead of "#1a2b3c" should degrade to
  // the default, not paint the city with an invalid CSS colour.
  const hex = (v, fallback) =>
    (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim())) ? v.trim() : fallback

  return {
    ground: hex(raw.ground, '#e9e3d6'),
    roads: hex(raw.roads, '#6e7078'),
    buildings: hex(raw.buildings, '#c9c2b4'),
    accent: hex(raw.accent, '#d97757'),
    sky: hex(raw.sky, '#dceaf2'),
    reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 240) : '',
  }
}

const POLICY_SYSTEM = `Eres un ingeniero de trafico que ajusta tiempos de semaforo.
Respondes SOLO con JSON valido, sin texto alrededor.

Cada cruce tiene DOS grupos de accesos que alternan: A y B.
Devuelves el reparto de verde [segundos_A, segundos_B].

Reglas:
- Cada verde va entre 8 y 55 segundos.
- REPARTE el tiempo: da mas a la direccion con mas cola y quita a la vacia.
- Manten la suma A+B parecida a la actual. Alargar el ciclo entero aumenta la
  espera de todos, incluso la de la direccion a la que das mas verde.
- No bajes ningun grupo de 8 segundos: dejarias coches atrapados.
- Cambia solo lo necesario. Si la diferencia de cola entre A y B es pequena,
  deja el reparto como esta: mover tiempo por ruido empeora la red.`

/**
 * One control decision. Given the worst queues, return green times.
 *
 * Only the busiest junctions are sent. The whole network would be thousands of
 * tokens per call for junctions that are empty and need nothing, and a model
 * asked to retime everything tends to retime everything -- which is a way of
 * having no policy at all.
 */
export async function signalPolicy(provider, key, model, world, signal, topN = 12) {
  const queues = world.queues()
  // A DEADBAND, and it is the difference between helping and hurting.
  //
  // Retiming on any non-zero queue means retiming on noise. A junction with
  // one car on one arm and none on the other is balanced in every sense that
  // matters, but "give more green to the busier side" reads that as 100% vs 0%
  // and swings the split hard. Measured across two cities: acting on every
  // non-empty junction made Barcelona 4.4% SLOWER with 14% more queue, while
  // the same rule helped Santo Domingo -- the difference being that Barcelona's
  // network was barely loaded, so almost every "imbalance" was a single car.
  //
  // So a junction is only worth a decision when it has enough traffic to
  // measure AND a gap wide enough to be real. Everything else keeps its
  // timings, which is the correct action rather than an absence of one.
  const busiest = imbalanced(queues, topN)

  if (!busiest.length) return { policy: null, applied: 0, considered: 0 }

  const current = new Map(world.signals.map((s) => [s.id, s.greens]))
  const rows = busiest.map(([id, q]) => {
    const g = current.get(id) ?? [28, 28]
    return `  {"id": ${id}, "cola_A": ${q.byGroup[0]}, "cola_B": ${q.byGroup[1]}, ` +
           `"verde_actual": [${g[0]}, ${g[1]}]}`
  }).join(',\n')

  const m = world.metrics()
  const user = `Estado de la red:
- velocidad media: ${m.meanSpeedKmh.toFixed(1)} km/h
- vehiculos detenidos: ${m.queued} de ${m.vehicles}

Cruces con mas cola:
[
${rows}
]

Devuelve el nuevo reparto para cada uno:
{"policy": {"<id>": [<segundos_A>, <segundos_B>]}}`

  const out = await complete(provider, key, {
    model, system: POLICY_SYSTEM, user, maxTokens: 600, signal,
  })

  let parsed
  try {
    parsed = parseJson(out)
  } catch {
    // A malformed reply costs one cycle of control, not the simulation.
    return { policy: null, applied: 0, considered: busiest.length, error: 'invalid JSON from the model' }
  }

  const policy = parsed.policy ?? parsed
  const applied = world.applyPolicy(policy)
  return { policy, applied, considered: busiest.length }
}

// The deadband shared by both controllers -- see signalPolicy for why acting
// below it makes a network worse rather than better.
const MIN_TOTAL = 4
const MIN_GAP = 3

/** Junctions with enough traffic to measure and a gap wide enough to be real. */
function imbalanced(queues, topN) {
  return [...queues.entries()]
    .filter(([, q]) => q.total >= MIN_TOTAL &&
                       Math.abs(q.byGroup[0] - q.byGroup[1]) >= MIN_GAP)
    .sort((a, b) => Math.abs(b[1].byGroup[0] - b[1].byGroup[1]) -
                    Math.abs(a[1].byGroup[0] - a[1].byGroup[1]))
    .slice(0, topN)
}

/**
 * The keyless controller: split each busy junction's cycle in proportion to
 * its two queues, keeping the cycle length.
 *
 * WHY THIS EXISTS
 * Without it, a visitor with no API key watched two identical fixed-time
 * worlds -- their own streets, but no improvement to look at, which is the one
 * thing this page is for. Proportional splitting is the textbook baseline for
 * adaptive control and needs no model: it is arithmetic on the same queue
 * counts the LLM is shown. The LLM path remains, as an alternative controller
 * the visitor can bring, not as the price of seeing any result.
 *
 * Same deadband, same 8-55 s clamp (applied in world.applyPolicy), same
 * constant-cycle rule the LLM prompt asks for -- so the two controllers are
 * comparable, and neither can win by quietly lengthening every cycle.
 */
export function proportionalPolicy(world, topN = 40) {
  const busiest = imbalanced(world.queues(), topN)
  if (!busiest.length) return { policy: null, applied: 0, considered: 0 }

  const current = new Map(world.signals.map((s) => [s.id, s.greens]))
  const policy = {}
  for (const [id, q] of busiest) {
    const [g0, g1] = current.get(id) ?? [28, 28]
    const cycle = g0 + g1
    // +1 on each side so an empty arm keeps a share rather than going to the
    // 8 s floor on the strength of one snapshot.
    const share = (q.byGroup[0] + 1) / (q.total + 2)
    // Move at most half-way to the target per decision. Jumping straight to it
    // chases the snapshot: the queue flips sides next cycle and so does the
    // split, which is oscillation, not control.
    const target = cycle * share
    const next0 = Math.round(g0 + (target - g0) * 0.5)
    policy[id] = [next0, cycle - next0]
  }
  const applied = world.applyPolicy(policy)
  return { policy, applied, considered: busiest.length }
}

/**
 * Keep the AI world under control while it runs.
 *
 * Deliberately slow. A model call costs money and latency, and signal timings
 * do not need revisiting every frame -- the Barcelona orchestrator runs on the
 * same principle. Failures are counted and tolerated; three in a row stops the
 * loop rather than burning the visitor's quota on something that is not working.
 */
export function startOrchestrator({ world, provider, key, model, everyMs = 9000, onTick }) {
  let stopped = false
  let failures = 0
  const controller = new AbortController()

  const tick = async () => {
    if (stopped) return
    try {
      const r = await signalPolicy(provider, key, model, world, controller.signal)
      failures = 0
      onTick?.({ ...r, at: Date.now() })
    } catch (e) {
      if (e.name === 'AbortError' || stopped) return
      failures++
      onTick?.({ error: e.message, applied: 0, failures })
      if (failures >= 3) { stopped = true; onTick?.({ error: e.message, halted: true }); return }
    }
    if (!stopped) setTimeout(tick, everyMs)
  }

  // A first pass almost immediately, so the visitor sees the AI do something
  // before the first long interval has elapsed.
  const first = setTimeout(tick, 1200)

  return () => { stopped = true; clearTimeout(first); controller.abort() }
}
