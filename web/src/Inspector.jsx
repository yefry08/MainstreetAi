import { AI_COLOR, BASE_COLOR } from './theme'

function Approaches({ rows }) {
  if (!rows?.length) return null
  const max = Math.max(1, ...rows.map((r) => r.q))
  return (
    <div className="approaches">
      {rows.map((r, i) => (
        <div key={i} className={`appr ${r.green ? 'g' : 'r'}`}>
          <span className="appr-lane" title={`${r.lanes} lane${r.lanes > 1 ? 's' : ''}`}>
            {r.lane}
            {r.lanes > 1 && <em className="lanes">×{r.lanes}</em>}
          </span>
          <span className="appr-bar">
            <i style={{ width: `${(r.q / max) * 100}%` }} />
          </span>
          <span className="appr-q">{r.q}</span>
        </div>
      ))}
    </div>
  )
}

function TwinCol({ w, color, title }) {
  if (!w) return <div className="twin-col empty">no data</div>
  const light = w.state?.includes('G') || w.state?.includes('g')
    ? 'green'
    : w.state?.includes('y')
    ? 'amber'
    : 'red'
  return (
    <div className="twin-col">
      <div className="twin-title" style={{ color }}>
        {title}
      </div>
      <div className="light-row">
        <span className={`light ${light}`} />
        <span className="phase">
          phase {w.phase + 1}/{w.n_phases} · {w.elapsed}s
        </span>
      </div>
      <div className="qsplit">
        <div>
          <b>{w.served}</b>
          <em>served</em>
        </div>
        <div>
          <b>{w.waiting}</b>
          <em>waiting</em>
        </div>
      </div>
      {w.bus_request && <div className="bus-flag">🚌 bus priority request active</div>}
      <div className="reason">{w.reason}</div>
      <Approaches rows={w.approaches} />
    </div>
  )
}

export default function Inspector({ signal, header, onClose }) {
  if (!signal) return null
  const twins = header?.twins || {}
  const wb = twins.baseline?.watch
  const wa = twins.ai?.watch
  const ready = (wb && wb.id === signal.id) || (wa && wa.id === signal.id)

  return (
    <div className="panel inspector">
      <div className="panel-head">
        <h2>Junction</h2>
        <button className="close" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="jname">{signal.label}</div>
      <div className="jmeta">
        {signal.links} controlled movements · {signal.phases} phases
        {signal.corridor && <span className="corr"> · {signal.corridor}</span>}
      </div>

      {!ready ? (
        <div className="waiting">reading live signal state…</div>
      ) : (
        <div className="twins">
          <TwinCol w={wb} color={BASE_COLOR} title="Fixed-time" />
          <TwinCol w={wa} color={AI_COLOR} title="AI-adaptive" />
        </div>
      )}

      {wa && (
        <div className="jstats">
          AI has granted <b>{wa.tsp_grants}</b> bus priorities and{' '}
          <b>{wa.early_releases}</b> early releases here.
        </div>
      )}
    </div>
  )
}
