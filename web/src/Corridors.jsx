import { AI_COLOR, BASE_COLOR } from './theme'

const NAMES = {
  diagonal: 'Avinguda Diagonal',
  gran_via: 'Gran Via de les Corts',
  meridiana: 'Avinguda Meridiana',
}

/**
 * Flow index is (speed / speed limit) across the corridor's edges, weighted by
 * the number of vehicles on each edge: 1.0 is free flow, 0 is stationary.
 * Weighting matters — an unweighted mean is dominated by empty edges reporting
 * their speed limit, which makes a jammed corridor look like it is flowing.
 */
export default function Corridors({ header }) {
  const b = header?.twins?.baseline?.corridors
  const a = header?.twins?.ai?.corridors
  if (!a || !Object.keys(a).length) return null

  const keys = Object.keys(a).sort()

  return (
    <div className="panel corridors">
      <div className="panel-head">
        <h2>Corridors</h2>
        <span className="sub">flow index</span>
      </div>

      {keys.map((k) => {
        const av = a[k]?.flow ?? 0
        const bv = b?.[k]?.flow ?? 0
        const gain = bv > 0 ? ((av - bv) / bv) * 100 : 0
        return (
          <div key={k} className="corr-row">
            <div className="corr-name">
              {NAMES[k] || k}
              <span className={`corr-gain ${gain > 0.5 ? 'good' : gain < -0.5 ? 'bad' : ''}`}>
                {gain > 0 ? '+' : ''}
                {gain.toFixed(1)}%
              </span>
            </div>
            <div className="corr-bars">
              <div className="corr-bar">
                <i style={{ width: `${bv * 100}%`, background: BASE_COLOR }} />
              </div>
              <div className="corr-bar">
                <i style={{ width: `${av * 100}%`, background: AI_COLOR }} />
              </div>
            </div>
            <div className="corr-nums">
              <span style={{ color: BASE_COLOR }}>{(b?.[k]?.kmh ?? 0).toFixed(1)}</span>
              <span style={{ color: AI_COLOR }}>{(a[k]?.kmh ?? 0).toFixed(1)}</span>
              <span className="corr-unit">
                km/h · {a[k]?.veh ?? 0} veh
              </span>
            </div>
          </div>
        )
      })}

      <div className="corr-note">
        A pilot would instrument one of these first — the signal hardware is
        already in place.
      </div>
    </div>
  )
}
