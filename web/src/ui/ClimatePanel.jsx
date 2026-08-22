import { useState } from 'react'

/**
 * Climate impact of the AI control layer.
 *
 * The signature element is the SPLIT METER: one horizontal glyph per metric,
 * with the fixed-time value and the AI value as opposing bars growing from a
 * shared centre line, and the gap between them filled in terracotta. Repeated
 * as the atomic unit instead of a grid of number tiles, it encodes the whole
 * pitch — "how much better, at a glance" — in one shape you learn to read once.
 *
 * Slate is the baseline, terracotta is the AI. That pairing is the colour
 * system's whole argument: the "before" case is inert, the "after" is warm.
 */

const fmt = (v, d = 0) =>
  v === undefined || v === null || Number.isNaN(v)
    ? '–'
    : Number(v).toLocaleString('en-GB', {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      })

// `better: 'down'` means a lower AI value is the win.
const CLIMATE = [
  { key: 'co2_kg', label: 'CO₂', unit: 'kg', d: 0 },
  { key: 'nox_kg', label: 'NOₓ', unit: 'kg', d: 2 },
  { key: 'fuel_l', label: 'Fuel', unit: 'l', d: 0 },
]

const FLOW = [
  { key: 'stopped_veh_hours', label: 'Time lost stopped', unit: 'veh·h', d: 1 },
  { key: 'bus_stopped_hours', label: 'Bus time lost', unit: 'veh·h', d: 2 },
  { key: 'p95_wait_s', label: 'p95 wait', unit: 's', d: 0 },
  { key: 'stranded', label: 'Waiting > 5 min', unit: 'veh', d: 0 },
]

function SplitMeter({ label, unit, base, ai, d }) {
  const hasData = base > 0 || ai > 0
  const max = Math.max(base || 0, ai || 0, 1e-9)
  const basePct = ((base || 0) / max) * 100
  const aiPct = ((ai || 0) / max) * 100
  const delta = base > 0 ? ((ai - base) / base) * 100 : 0
  const better = delta < -0.5

  return (
    <div className="meter">
      <div className="meter-head">
        <span className="meter-label">
          {label}
          <em>{unit}</em>
        </span>
        <span className={`meter-delta value ${better ? 'good' : delta > 0.5 ? 'bad' : ''}`}>
          {hasData ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%` : '–'}
        </span>
      </div>

      {/* Two bars growing outward from a shared centre rule. */}
      <div className="meter-body">
        <div className="meter-side left">
          <i style={{ width: `${basePct}%` }} />
        </div>
        <div className="meter-rule" />
        <div className="meter-side right">
          <i className="ai" style={{ width: `${aiPct}%` }} />
        </div>
      </div>

      <div className="meter-foot">
        <span className="value base">{fmt(base, d)}</span>
        <span className="meter-legend">fixed · AI</span>
        <span className="value ai">{fmt(ai, d)}</span>
      </div>
    </div>
  )
}

export default function ClimatePanel({ header }) {
  const [open, setOpen] = useState(true)
  const twins = header?.twins || {}
  const b = twins.baseline?.metrics
  const a = twins.ai?.metrics
  if (!b || !a) return null

  const co2Saved = Math.max(0, (b.co2_kg || 0) - (a.co2_kg || 0))
  const co2Pct = b.co2_kg > 0 ? ((a.co2_kg - b.co2_kg) / b.co2_kg) * 100 : 0
  // Emissions only become a like-for-like comparison once both twins have
  // cleared a comparable number of trips. Before that the AI looks worse
  // because it has done more work — see README. Saying so beats hiding it.
  const settled = (b.completed || 0) > 250 && (a.completed || 0) > 250

  return (
    <section className={`glass panel climate ${open ? '' : 'collapsed'}`}>
      <header className="panel-head" onClick={() => setOpen((v) => !v)}>
        <h2>Climate impact</h2>
        <span className="panel-toggle">{open ? '–' : '+'}</span>
      </header>

      {open && (
        <>
          <div className="headline-figure">
            <div className="headline-value value">
              {settled ? fmt(co2Saved, 0) : '—'}
              <em>kg</em>
            </div>
            <div className="headline-caption">
              CO₂ avoided so far
              {settled && (
                <b className={co2Pct < 0 ? 'good' : ''}>
                  {' '}
                  {co2Pct > 0 ? '+' : ''}
                  {co2Pct.toFixed(1)}%
                </b>
              )}
            </div>
          </div>

          {!settled && (
            <p className="climate-note">
              Emissions are not comparable yet. The AI twin has completed{' '}
              <b className="value">{fmt(a.completed)}</b> trips to the baseline's{' '}
              <b className="value">{fmt(b.completed)}</b> — it burns more fuel
              early because it is doing more work. Read this after both pass ~250.
            </p>
          )}

          <div className="meter-group">
            {CLIMATE.map((m) => (
              <SplitMeter
                key={m.key}
                label={m.label}
                unit={m.unit}
                d={m.d}
                base={b[m.key]}
                ai={a[m.key]}
              />
            ))}
          </div>

          <div className="panel-rule" />

          <div className="meter-group">
            {FLOW.map((m) => (
              <SplitMeter
                key={m.key}
                label={m.label}
                unit={m.unit}
                d={m.d}
                base={b[m.key]}
                ai={a[m.key]}
              />
            ))}
          </div>

          <footer className="panel-note">
            Both twins run identical demand on the real network; the only
            difference is the signal controller. Percentages are simulation
            outcomes, not field measurements.
          </footer>
        </>
      )}
    </section>
  )
}
