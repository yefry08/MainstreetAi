/**
 * The stripped-down impact panel: four numbers, nothing else.
 *
 * The previous rail carried eight metrics, a mode legend and a day selector.
 * That is a dashboard for someone auditing the model, not for someone watching
 * a demo for ninety seconds. These four are the ones that answer "so what":
 * time saved, CO2 avoided, how long a driver waits, and whether buses are
 * getting through.
 *
 * TIME SAVED IS DERIVED, AND SAYS SO
 * SUMO reports stopped-vehicle HOURS per twin. The headline is the difference
 * between them, in minutes -- real vehicle-minutes not spent stationary, not a
 * projection or an extrapolation to a whole city. The tooltip carries the
 * arithmetic so the number can be checked rather than trusted.
 */

const fmt = (v, digits = 0) =>
  v == null || Number.isNaN(v) ? '–'
    : v.toLocaleString(undefined, { minimumFractionDigits: digits,
                                    maximumFractionDigits: digits })

export default function ImpactPanel({ twins, replayStats }) {
  const src = replayStats ?? twins
  const a = src?.ai
  const b = src?.baseline

  const has = a && b

  // Vehicle-minutes not spent stationary, baseline minus AI.
  const savedMin = has ? (b.stopped_veh_hours - a.stopped_veh_hours) * 60 : null
  const co2Pct = has && b.co2_kg
    ? ((a.co2_kg - b.co2_kg) / b.co2_kg) * 100 : null
  const co2Kg = has && a.co2_kg != null ? b.co2_kg - a.co2_kg : null
  const waitPct = has && b.p95_wait_s
    ? ((a.p95_wait_s - b.p95_wait_s) / b.p95_wait_s) * 100 : null
  const busPct = has && b.bus_avg_speed_kmh
    ? ((a.bus_avg_speed_kmh - b.bus_avg_speed_kmh) / b.bus_avg_speed_kmh) * 100
    : null

  const rows = [
    {
      label: 'CO₂ avoided',
      value: co2Kg == null ? '–' : `${fmt(co2Kg)} kg`,
      delta: co2Pct,
      good: co2Pct != null && co2Pct < 0,
      title: co2Kg == null ? '' :
        `SUMO HBEFA3, computed per vehicle from speed traces.\n` +
        `fixed-time ${fmt(b.co2_kg)} kg vs AI ${fmt(a.co2_kg)} kg`,
    },
    {
      label: 'Driver wait (p95)',
      value: has && a.p95_wait_s != null ? `${fmt(a.p95_wait_s)} s` : '–',
      delta: waitPct,
      good: waitPct != null && waitPct < 0,
      title: has ? `95th percentile wait.\nfixed-time ${fmt(b.p95_wait_s)} s ` +
        `vs AI ${fmt(a.p95_wait_s)} s` : '',
    },
    {
      label: 'Bus speed',
      value: has && a.bus_avg_speed_kmh != null
        ? `${fmt(a.bus_avg_speed_kmh, 1)} km/h` : '–',
      delta: busPct,
      good: busPct != null && busPct > 0,
      title: has ? `Time-integrated: distance / vehicle-seconds.\n` +
        `fixed-time ${fmt(b.bus_avg_speed_kmh, 1)} vs AI ` +
        `${fmt(a.bus_avg_speed_kmh, 1)} km/h` : '',
    },
  ]

  return (
    <section className="impact glass">
      <div className="impact-head">
        <h2>Impact</h2>
        <span className="impact-sub">AI vs fixed-time</span>
      </div>

      <div
        className="impact-hero"
        title={savedMin == null ? '' :
          `Vehicle-minutes not spent stationary.\n` +
          `fixed-time ${fmt(b.stopped_veh_hours, 1)} veh·h vs AI ` +
          `${fmt(a.stopped_veh_hours, 1)} veh·h, difference in minutes.`}
      >
        <div className="impact-value">{savedMin == null ? '–' : fmt(savedMin)}</div>
        <div className="impact-unit">vehicle-minutes saved</div>
      </div>

      <div className="impact-rows">
        {rows.map((r) => (
          <div className="impact-row" key={r.label} title={r.title}>
            <span className="impact-label">{r.label}</span>
            <span className="impact-num">{r.value}</span>
            <span className={`impact-delta ${r.delta == null ? '' : (r.good ? 'good' : 'bad')}`}>
              {r.delta == null ? '–'
                : `${r.delta > 0 ? '+' : ''}${r.delta.toFixed(1)}%`}
            </span>
          </div>
        ))}
      </div>

      <p className="impact-note">
        Both twins run identical demand on the real network; the only difference
        is the signal controller. Simulation outcomes, not field measurements.
      </p>
    </section>
  )
}
