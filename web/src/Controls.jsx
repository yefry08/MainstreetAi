import { useState } from 'react'
import { postControl, postEvent } from './useSimSocket'
import { AI_COLOR, BASE_COLOR, CONGESTION_LEGEND } from './theme'

const EVENTS = [
  {
    kind: 'concert',
    icon: '🎤',
    title: 'Camp Nou lets out',
    detail: '900 extra cars injected around the stadium over 10 minutes',
  },
  {
    kind: 'metro_disruption',
    icon: '🚇',
    title: 'Metro L1 disruption',
    detail: '650 displaced trips dumped onto the Meridiana corridor',
  },
  {
    kind: 'rain',
    icon: '🌧️',
    title: 'Rain starts',
    detail: 'speed factor 0.78, headways up, cyclists slow 28%',
  },
  {
    kind: 'clear_weather',
    icon: '☀️',
    title: 'Rain stops',
    detail: 'restore dry-road driving behaviour',
  },
]

export default function Controls({ header, toggles, setToggles }) {
  const [busy, setBusy] = useState(null)
  const paused = header?.paused ?? false
  const speed = header?.speed ?? 5
  const focus = header?.focus ?? 'ai'

  const fire = async (kind) => {
    setBusy(kind)
    await postEvent(kind)
    setTimeout(() => setBusy(null), 900)
  }

  return (
    <div className="panel controls">
      <div className="panel-head">
        <h2>Controls</h2>
      </div>

      {/* ---- which twin the map shows ---- */}
      <div className="seg-wrap">
        <div className="seg-label">Map is showing</div>
        <div className="seg">
          <button
            className={focus === 'baseline' ? 'on base' : ''}
            onClick={() => postControl('focus', 'baseline')}
            style={focus === 'baseline' ? { borderColor: BASE_COLOR } : undefined}
          >
            Fixed-time
          </button>
          <button
            className={focus === 'ai' ? 'on ai' : ''}
            onClick={() => postControl('focus', 'ai')}
            style={focus === 'ai' ? { borderColor: AI_COLOR } : undefined}
          >
            AI-adaptive
          </button>
        </div>
        <div className="seg-note">
          Both keep running either way — only the rendered twin changes.
        </div>
      </div>

      {/* ---- transport ---- */}
      <div className="row">
        <button className="btn wide" onClick={() => postControl('pause', !paused)}>
          {paused ? '▶  Resume' : '❚❚  Pause'}
        </button>
      </div>

      <div className="slider-row">
        <label>
          Speed <b>{speed}×</b> realtime
        </label>
        <input
          type="range"
          min="1"
          max="15"
          step="1"
          value={speed}
          onChange={(e) => postControl('speed', Number(e.target.value))}
        />
      </div>

      {/* ---- scenario injection ---- */}
      <div className="panel-head sub-head">
        <h3>Inject a scenario</h3>
      </div>
      <div className="events">
        {EVENTS.map((e) => (
          <button
            key={e.kind}
            className={`event ${busy === e.kind ? 'busy' : ''}`}
            onClick={() => fire(e.kind)}
            title={e.detail}
          >
            <span className="ev-icon">{e.icon}</span>
            <span className="ev-text">
              <b>{e.title}</b>
              <em>{e.detail}</em>
            </span>
          </button>
        ))}
      </div>
      <div className="seg-note">
        Events hit both twins identically, so the comparison stays fair.
      </div>

      {/* ---- layers ---- */}
      <div className="panel-head sub-head">
        <h3>Layers</h3>
      </div>
      <div className="toggles">
        {[
          ['vehicles', 'Vehicles'],
          ['roads', 'Congestion'],
          ['signals', 'Signals'],
          ['bike', 'Bike lanes'],
        ].map(([k, label]) => (
          <label key={k} className="tog">
            <input
              type="checkbox"
              checked={toggles[k]}
              onChange={(e) => setToggles({ ...toggles, [k]: e.target.checked })}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>

      <div className="legend">
        <div className="legend-title">Congestion</div>
        <div className="ramp">
          {CONGESTION_LEGEND.map(([c, l]) => (
            <div key={l} className="ramp-cell" title={l}>
              <i style={{ background: c }} />
            </div>
          ))}
        </div>
        <div className="ramp-labels">
          <span>free</span>
          <span>jammed</span>
        </div>
        <div className="legend-title" style={{ marginTop: 10 }}>
          Vehicles
        </div>
        <div className="dots">
          <span className="dot" style={{ background: 'rgb(150,170,200)' }} /> car
          <span className="dot" style={{ background: 'rgb(255,138,40)' }} /> bus
          <span className="dot" style={{ background: 'rgb(60,214,245)' }} /> bike
          <span className="dot" style={{ background: 'rgb(255,96,88)' }} /> stopped
        </div>
      </div>
    </div>
  )
}
