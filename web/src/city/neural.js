/**
 * The neural signal controller: a small MLP that decides each junction's green
 * split from its queues.
 *
 * ONE FILE FOR TRAINING AND FOR VISITORS
 * The training notebook (training/) does not reimplement any of this in
 * Python. It drives web/scripts/nn-eval.mjs, which imports THIS module and
 * sim.js, so the network is optimised against the exact simulator and the
 * exact feature code that later run in a visitor's browser. A Python port
 * would be faster to train against and would drift: the model would learn the
 * port's quirks, and nothing would say so.
 *
 * SHAPE
 * Shared weights across junctions -- the same small network looks at every
 * junction in turn, like the rule-based controller does -- so it works on any
 * city's network size without retraining. Per junction:
 *
 *   6 features -> 16 tanh -> 1 tanh   (129 parameters)
 *
 * and the output is a nudge to the share of the cycle given to group A. The
 * cycle length is kept and greens are clamped to 8-55 s by world.applyPolicy,
 * the same rules every controller here obeys, so the network cannot "win" by
 * lengthening cycles or starving an arm.
 */

export const FORMAT = 'mainstreetai-signal-mlp'
export const VERSION = 1

export const FEATURE_NAMES = [
  'queue_a / 8', 'queue_b / 8', 'green_share_a', 'cycle_s / 110',
  '(queue_a - queue_b) / (queue_a + queue_b + 1)', 'queue_total / 8',
]

/** Per-junction inputs. Scaled so typical values sit roughly in [-1, 1]. */
export function features(q, greens) {
  const [g0, g1] = greens
  const cycle = g0 + g1
  const [a, b] = q.byGroup
  return [a / 8, b / 8, g0 / cycle, cycle / 110, (a - b) / (a + b + 1), (a + b) / 8]
}

/**
 * Validate a model object before trusting it. It may have come over the
 * network from Hugging Face, so a wrong shape must fail loudly here rather
 * than as NaN green times later.
 */
export function checkModel(m) {
  const fail = (why) => { throw new Error(`Invalid signal model: ${why}`) }
  if (!m || m.format !== FORMAT) fail('wrong format tag')
  if (m.version !== VERSION) fail(`version ${m.version}, expected ${VERSION}`)
  const nIn = FEATURE_NAMES.length
  const h = m.hidden
  if (!Number.isInteger(h) || h < 1 || h > 256) fail('bad hidden size')
  if (!Array.isArray(m.w1) || m.w1.length !== h || m.w1.some((r) => r.length !== nIn)) fail('w1 shape')
  if (!Array.isArray(m.b1) || m.b1.length !== h) fail('b1 shape')
  if (!Array.isArray(m.w2) || m.w2.length !== h) fail('w2 shape')
  const all = [...m.w1.flat(), ...m.b1, ...m.w2, m.b2, m.maxStep]
  if (!all.every(Number.isFinite)) fail('non-finite weight')
  if (!(m.maxStep > 0 && m.maxStep <= 0.5)) fail('maxStep out of range')
  return m
}

/** One forward pass. Output in [-1, 1]. */
export function forward(m, x) {
  let out = m.b2
  for (let j = 0; j < m.hidden; j++) {
    const w = m.w1[j]
    let s = m.b1[j]
    for (let i = 0; i < x.length; i++) s += w[i] * x[i]
    out += m.w2[j] * Math.tanh(s)
  }
  return Math.tanh(out)
}

/**
 * One control decision over every signalised junction.
 *
 * Returns the same shape as proportionalPolicy so the two are interchangeable
 * wherever a controller is called.
 */
export function neuralPolicy(world, m) {
  const queues = world.queues()
  const policy = {}
  let considered = 0
  for (const s of world.signals) {
    const q = queues.get(s.id)
    if (!q) continue
    considered++
    const cycle = s.greens[0] + s.greens[1]
    const y = forward(m, features(q, s.greens))
    const share = Math.min(0.85, Math.max(0.15, s.greens[0] / cycle + m.maxStep * y))
    const g0 = Math.round(cycle * share)
    if (g0 === s.greens[0]) continue
    policy[s.id] = [g0, cycle - g0]
  }
  return { policy, applied: world.applyPolicy(policy), considered }
}
