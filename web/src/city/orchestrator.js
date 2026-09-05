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

const PALETTE_SYSTEM = `Eres un director de arte especializado en identidad visual urbana.
Respondes SOLO con JSON valido, sin texto alrededor.`

/**
 * The city's colours. This is the "use the colour that best represents the
 * city" step, and it is the one place a model's cultural knowledge does real
 * work that data cannot.
 */
export async function cityPalette(provider, key, model, city, signal) {
  const user = `Ciudad: ${city.name}, ${city.country}.

Elige una paleta que represente visualmente a esta ciudad: su luz, sus
materiales de construccion, su clima y su caracter. No uses colores genericos.

Devuelve exactamente este JSON:
{
  "ground": "#rrggbb",
  "roads": "#rrggbb",
  "buildings": "#rrggbb",
  "accent": "#rrggbb",
  "sky": "#rrggbb",
  "reason": "una frase de por que estos colores representan la ciudad"
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
  const MIN_TOTAL = 4
  const MIN_GAP = 3
  const busiest = [...queues.entries()]
    .filter(([, q]) => q.total >= MIN_TOTAL &&
                       Math.abs(q.byGroup[0] - q.byGroup[1]) >= MIN_GAP)
    .sort((a, b) => Math.abs(b[1].byGroup[0] - b[1].byGroup[1]) -
                    Math.abs(a[1].byGroup[0] - a[1].byGroup[1]))
    .slice(0, topN)

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
    return { policy: null, applied: 0, considered: busiest.length, error: 'JSON invalido' }
  }

  const policy = parsed.policy ?? parsed
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
