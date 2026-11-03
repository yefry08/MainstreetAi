/**
 * Fuel and CO2 for the browser simulation, per vehicle per step.
 *
 * WHY THIS EXISTS
 * Barcelona and Manhattan report CO2 because SUMO computes it. The browser
 * simulator behind every other city did not, so "how much CO2 does adaptive
 * signal timing save" had no answer for 87 of the 89 cities.
 *
 * THE MODEL: power-based instantaneous fuel consumption, after Akçelik &
 * Besley (2003, ARRB), the family of models traffic engineers use to compare
 * signal timings. Fuel per second is
 *
 *   alpha                                         when not pulling (idle,
 *                                                 coasting, braking)
 *   alpha + beta1 * R_T * v + beta2 * M * a^2 * v / 1000   otherwise
 *
 * with tractive force R_T = b1 + b2 v^2 + M a / 1000 (kN; flat roads).
 * The three terms are exactly what signal timing changes: time spent idling at
 * a red, cruising, and the extra fuel burned getting back up to speed after
 * every stop.
 *
 * WHAT TO TRUST, AND WHAT NOT
 * The constants are typical published values for a petrol car and a diesel
 * bus. Checked against known figures: a car at a steady 50 km/h comes out at
 * ~152 g CO2/km (~6.6 L/100 km), idling at ~0.9 g CO2/s (~1.35 L/h) -- both
 * ordinary for a mid-size petrol car. Absolute kilograms are therefore
 * indicative of the order of magnitude. The comparison between fixed timing and
 * adaptive control is the robust part: both twins share the same vehicles,
 * the same model and the same constants, so the difference is the stops and
 * the idling, not the calibration.
 */

// Per vehicle kind: 0 car, 1 bus, 2 bike (sim.js).
const PARAMS = {
  // alpha mL/s, beta1 mL/kJ, beta2 mL/(kJ*m/s^2), mass kg, b1 kN, b2 kN/(m/s)^2,
  // grams of CO2 per mL of fuel (petrol 2.31, diesel 2.68).
  0: { alpha: 0.375, beta1: 0.072, beta2: 0.0344, mass: 1400, b1: 0.333, b2: 0.00108, co2PerMl: 2.31 },
  1: { alpha: 1.10, beta1: 0.072, beta2: 0.0344, mass: 13000, b1: 1.80, b2: 0.0055, co2PerMl: 2.68 },
}

/**
 * The most acceleration the high-acceleration penalty is ever charged for.
 *
 * The simulator reaches its target speed in a few steps -- from a standstill a
 * car gains ~6 m/s in one 0.25 s step, i.e. ~25 m/s^2, about 2.5 g. Feeding
 * that to the a^2 term below charged ~190 mL/s for a single step and put the
 * fleet at ~7 g CO2 per vehicle-second, five times a real city's. The energy
 * of getting up to speed is still counted in full through the tractive term
 * (it depends on the speed gained, not on how fast); only the inefficiency
 * penalty is capped, at what a real car can actually do.
 */
const MAX_PENALISED_ACCEL = 2.5

/** Fuel burned this step, in mL. Bikes burn none. */
export function fuelMl(kind, v, a, dt) {
  const p = PARAMS[kind]
  if (!p) return 0
  const rt = p.b1 + p.b2 * v * v + (p.mass * a) / 1000
  let rate = p.alpha
  if (rt > 0 && v > 0) {
    rate += p.beta1 * rt * v
    if (a > 0) {
      const ap = Math.min(a, MAX_PENALISED_ACCEL)
      rate += (p.beta2 * p.mass * ap * ap * v) / 1000
    }
  }
  return rate * dt
}

/** CO2 for that fuel, in grams. */
export const co2Grams = (kind, ml) => ml * (PARAMS[kind]?.co2PerMl ?? 0)

/** For the checks in sim.test.mjs: steady-state figures a reader can verify. */
export function steadyCo2PerKm(kind, kmh) {
  const v = kmh / 3.6
  const perSecond = co2Grams(kind, fuelMl(kind, v, 0, 1))
  return (perSecond / v) * 1000
}
export const idleCo2PerSecond = (kind) => co2Grams(kind, fuelMl(kind, 0, 0, 1))
