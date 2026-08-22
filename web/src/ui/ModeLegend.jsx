/**
 * The five modes on Barcelona's streets, with live counts.
 *
 * Doubles as the map key — swatches match the vehicle colours exactly, so the
 * panel tells you what you are looking at without a separate legend.
 *
 * Motorcycles are here because roughly a third of Barcelona's fleet is two
 * wheels, a share almost no other European city approaches. A "Barcelona
 * traffic" model without them is a model of somewhere else.
 */

const MODES = [
  { key: 'running', label: 'On street', swatch: null, total: true },
  { key: 'moto_running', label: 'Motorcycles', swatch: '#d9c48a' },
  { key: 'bus_running', label: 'Buses', swatch: '#ffe3b0' },
  { key: 'truck_running', label: 'Vans & trucks', swatch: '#b8c0cc' },
  { key: 'bike_running', label: 'Bicycles', swatch: '#4fd8e8' },
]

export default function ModeLegend({ header }) {
  const m = header?.twins?.ai?.metrics
  if (!m) return null

  // Cars are whatever is left — the server reports the specialised modes and
  // the total, so deriving cars here avoids sending a redundant field.
  const cars = Math.max(
    0,
    (m.running || 0) -
      (m.moto_running || 0) -
      (m.bus_running || 0) -
      (m.truck_running || 0) -
      (m.bike_running || 0)
  )

  const rows = [
    { label: 'Cars', swatch: '#7e8ca3', value: cars },
    ...MODES.filter((x) => !x.total).map((x) => ({
      label: x.label,
      swatch: x.swatch,
      value: m[x.key] || 0,
    })),
  ]
  const total = m.running || 0

  return (
    <section className="glass panel modes">
      <header className="panel-head">
        <h2>On street</h2>
        <span className="panel-sub value">{total.toLocaleString()}</span>
      </header>

      <div className="mode-rows">
        {rows.map((r) => (
          <div key={r.label} className="mode-row">
            <span className="mode-swatch" style={{ background: r.swatch }} />
            <span className="mode-label">{r.label}</span>
            <span className="mode-bar">
              <i
                style={{
                  width: `${total ? (r.value / total) * 100 : 0}%`,
                  background: r.swatch,
                }}
              />
            </span>
            <span className="mode-count value">{r.value.toLocaleString()}</span>
          </div>
        ))}
      </div>

      <div className="mode-queued">
        <span className="mode-swatch" style={{ background: 'var(--aturat)' }} />
        <span className="mode-label">Queued right now</span>
        <span className="mode-count value queued">
          {(m.halting || 0).toLocaleString()}
        </span>
      </div>
    </section>
  )
}
