import { AI_COLOR, BASE_COLOR } from './theme'

const fmt = (v, d = 1) =>
  v === undefined || v === null || Number.isNaN(v)
    ? '–'
    : Number(v).toLocaleString('en-GB', {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      })

/**
 * `better` says which direction is an improvement, so the arrow and the colour
 * stay correct whether the metric is delay (down is good) or speed (up is good).
 */
const ROWS = [
  { key: 'avg_trip_time_s', label: 'Avg trip time', unit: 's', better: 'down', d: 0 },
  { key: 'mean_speed_kmh', label: 'Network speed', unit: 'km/h', better: 'up', d: 1 },
  { key: 'stopped_veh_hours', label: 'Time lost stopped', unit: 'veh·h', better: 'down', d: 1 },
  { key: 'halting', label: 'Queued right now', unit: 'veh', better: 'down', d: 0 },
  { key: 'bus_mean_speed_kmh', label: 'Bus speed', unit: 'km/h', better: 'up', d: 1, transit: true },
  { key: 'bus_stopped_hours', label: 'Bus time lost', unit: 'veh·h', better: 'down', d: 2, transit: true },
  { key: 'co2_kg', label: 'CO₂ emitted', unit: 'kg', better: 'down', d: 0, green: true },
  { key: 'nox_kg', label: 'NOₓ emitted', unit: 'kg', better: 'down', d: 2, green: true },
  { key: 'completed', label: 'Trips completed', unit: '', better: 'up', d: 0 },
]

// Kept separate and labelled: these answer "does it help the average by
// abandoning somebody?", which is the first thing a sceptical judge should ask.
const EQUITY_ROWS = [
  { key: 'p95_wait_s', label: 'p95 wait', unit: 's', better: 'down', d: 0 },
  { key: 'max_wait_s', label: 'Worst wait', unit: 's', better: 'down', d: 0 },
  { key: 'stranded', label: 'Waiting >5 min', unit: 'veh', better: 'down', d: 0 },
]

function Delta({ base, ai, better }) {
  if (!base || base === 0 || ai === undefined) return <span className="delta flat">–</span>
  const pct = ((ai - base) / Math.abs(base)) * 100
  if (!Number.isFinite(pct)) return <span className="delta flat">–</span>
  const good = better === 'down' ? pct < -0.5 : pct > 0.5
  const bad = better === 'down' ? pct > 0.5 : pct < -0.5
  return (
    <span className={`delta ${good ? 'good' : bad ? 'bad' : 'flat'}`}>
      {pct > 0 ? '+' : ''}
      {pct.toFixed(1)}%
    </span>
  )
}

export default function Dashboard({ header }) {
  const twins = header?.twins || {}
  const b = twins.baseline?.metrics
  const a = twins.ai?.metrics
  const waiting = !b || !a

  // Headline: how much standing-still time the AI removed.
  let headline = null
  if (b?.stopped_veh_hours > 0.2 && a) {
    const pct = ((a.stopped_veh_hours - b.stopped_veh_hours) / b.stopped_veh_hours) * 100
    headline = pct
  }

  return (
    <div className="panel dashboard">
      <div className="panel-head">
        <h2>Live A/B</h2>
        <span className="sub">both twins, same demand, same seed</span>
      </div>

      {waiting ? (
        <div className="waiting">warming up both simulations…</div>
      ) : (
        <>
          {headline !== null && (
            <div className={`headline ${headline < 0 ? 'good' : 'bad'}`}>
              <div className="headline-num">
                {headline > 0 ? '+' : ''}
                {headline.toFixed(1)}%
              </div>
              <div className="headline-label">
                vehicle-hours lost at a standstill,
                <br />
                AI vs fixed-time
              </div>
            </div>
          )}

          {b.co2_kg > 1 && (
            <div className="avoided">
              <b>{fmt(Math.max(0, b.co2_kg - a.co2_kg), 0)} kg</b> CO₂ avoided so
              far this run, across the modelled area.
              <em>
                The percentage is the transferable number — the saving is
                congestion-dependent, so it does not scale linearly to a full
                day. We are not extrapolating one.
              </em>
            </div>
          )}

          <table className="metrics">
            <thead>
              <tr>
                <th />
                <th style={{ color: BASE_COLOR }}>Fixed</th>
                <th style={{ color: AI_COLOR }}>AI</th>
                <th>Δ</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.key} className={r.transit ? 'transit' : r.green ? 'green' : ''}>
                  <td className="label">
                    {r.label}
                    {r.unit && <span className="unit"> {r.unit}</span>}
                  </td>
                  <td className="num">{fmt(b[r.key], r.d)}</td>
                  <td className="num strong">{fmt(a[r.key], r.d)}</td>
                  <td className="num">
                    <Delta base={b[r.key]} ai={a[r.key]} better={r.better} />
                  </td>
                </tr>
              ))}

              <tr className="section">
                <td colSpan={4}>
                  Equity check — is anyone worse off?
                </td>
              </tr>
              {EQUITY_ROWS.map((r) => (
                <tr key={r.key} className="equity">
                  <td className="label">
                    {r.label}
                    {r.unit && <span className="unit"> {r.unit}</span>}
                  </td>
                  <td className="num">{fmt(b[r.key], r.d)}</td>
                  <td className="num strong">{fmt(a[r.key], r.d)}</td>
                  <td className="num">
                    <Delta base={b[r.key]} ai={a[r.key]} better={r.better} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="ai-activity">
            <div className="ai-activity-head">AI interventions so far</div>
            <div className="chips">
              <span className="chip">
                <b>{(twins.ai?.stats?.tsp_grants || 0).toLocaleString()}</b> bus priority
              </span>
              <span className="chip">
                <b>{(twins.ai?.stats?.early_releases || 0).toLocaleString()}</b> early release
              </span>
              <span className="chip">
                <b>{(twins.ai?.stats?.extensions || 0).toLocaleString()}</b> green held
              </span>
            </div>
          </div>

          <div className="perf">
            sim step: fixed {fmt(twins.baseline?.step_ms, 0)} ms · ai{' '}
            {fmt(twins.ai?.step_ms, 0)} ms
          </div>
        </>
      )}
    </div>
  )
}
