/**
 * Predicted congestion for an hour: which signalised junctions get how many
 * extra cars, and from which places. Built from a district's baked generators
 * (scripts/bake-predict.mjs) and the time profiles in ./generators.js.
 */
import { KINDS, hourly } from './generators.js'

/**
 * pred: the baked file. Returns {
 *   total, byKind: {kind: cars},
 *   hotspots: [{signal, cars, reasons: [{name, kind, dir, cars}]}]  (worst first),
 *   active: [{gen, cars, dir}]  (generators moving cars this hour),
 * }
 */
export function predictHour(pred, { day = 2, hour = 8, rain = 0, game = false } = {}) {
  const perSignal = new Map()
  const byKind = {}
  const active = []
  let total = 0
  for (const g of pred.generators) {
    const h = hourly(g, { day, rain, event: game })
    const cin = h.in[hour], cout = h.out[hour]
    const cars = cin + cout
    if (cars < 0.5) continue
    total += cars
    byKind[g.kind] = (byKind[g.kind] ?? 0) + cars
    const dir = cin >= cout ? 'in' : 'out'
    active.push({ gen: g, cars, dir })
    for (const [si, w] of g.signals) {
      const s = perSignal.get(si) ?? { signal: pred.signals[si], cars: 0, reasons: [] }
      s.cars += cars * w
      s.reasons.push({ name: g.name, kind: g.kind, dir, cars: cars * w })
      perSignal.set(si, s)
    }
  }
  const hotspots = [...perSignal.values()]
    .map((s) => ({ ...s, reasons: s.reasons.sort((a, b) => b.cars - a.cars).slice(0, 3) }))
    .sort((a, b) => b.cars - a.cars)
  return { total, byKind, hotspots, active: active.sort((a, b) => b.cars - a.cars) }
}

/** Predicted extra cars for every hour of a day, for the timeline. */
export function predictDay(pred, opts = {}) {
  const out = new Array(24).fill(0)
  for (const g of pred.generators) {
    const h = hourly(g, { day: opts.day ?? 2, rain: opts.rainAt?.(0) ?? opts.rain ?? 0, event: opts.game })
    for (let i = 0; i < 24; i++) out[i] += h.in[i] + h.out[i]
  }
  return out
}

export const kindLabel = (kind, lang) => KINDS[kind]?.label[lang === 'es' ? 1 : 0] ?? kind
