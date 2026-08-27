import { useCallback, useEffect, useState } from 'react'

/**
 * Baseline / AI switch, plus the before-and-after it implies.
 *
 * WHAT THIS ACTUALLY SWITCHES, AND WHY THAT WORDING MATTERS
 * Both twins run continuously, side by side, on byte-identical demand. This
 * control changes which of them the map is drawing -- it does not reconfigure
 * a controller. That is the more defensible claim as well as the true one: the
 * viewer is watching two real simulations disagree, not a rendering mode
 * change. If it swapped a controller live, every number would be confounded by
 * whatever state the network happened to be in at the moment of the swap.
 *
 * The stats come from /api/twins, which reports BOTH twins at once, so the
 * comparison is always available regardless of which one is on screen.
 */

const POLL_MS = 2500

// On a static host there is no Python server behind these calls. Without this
// the panel retried /api/twins every 2.5s for as long as the page stayed open,
// and the twin switch POSTed to a /api/control that answers 404 -- so the one
// control the whole demo turns on quietly did nothing once deployed.
const REPLAY_ONLY = import.meta.env?.VITE_REPLAY_ONLY === '1'

export default function AiToggle({ onFocusChange, compact = false }) {
  const [focus, setFocus] = useState('ai')
  const [twins, setTwins] = useState(null)
  const [busy, setBusy] = useState(false)

  const post = useCallback(async (body) => {
    try {
      const r = await fetch('/api/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return r.ok ? await r.json() : null
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    if (REPLAY_ONLY) return
    let alive = true
    let timer = null
    const poll = async () => {
      try {
        const r = await fetch('/api/twins')
        const d = await r.json()
        if (alive) setTwins(d)
      } catch {
        if (alive) setTwins(null)
      }
      if (alive) timer = setTimeout(poll, POLL_MS)
    }
    poll()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [])

  const choose = async (next) => {
    if (busy || next === focus) return
    setFocus(next)
    onFocusChange?.(next)
    // Replay swaps which recording is drawn, locally and instantly. There is
    // no request to wait on, so there is nothing to disable the buttons for.
    if (REPLAY_ONLY) return
    setBusy(true)
    await post({ action: 'focus', value: next })
    // Speed is a REQUEST, not a guarantee. The server paces itself to the
    // simulation it can actually compute, and at high density SUMO already
    // runs below realtime -- measured at 0.47x with 3,100 vehicles. Asking for
    // 2x when the network is jammed changes nothing, so the label reports what
    // was asked for rather than implying an achieved rate.
    await post({ action: 'speed', value: next === 'ai' ? 10 : 5 })
    setBusy(false)
  }

  const a = twins?.ai
  const b = twins?.baseline
  const pct = (ai, base, betterIsUp) => {
    if (ai == null || base == null || !base) return null
    const d = ((ai - base) / Math.abs(base)) * 100
    return { value: d, good: betterIsUp ? d > 0 : d < 0 }
  }

  const rows = [
    ['Network speed', pct(a?.avg_speed_kmh, b?.avg_speed_kmh, true),
     a?.avg_speed_kmh, b?.avg_speed_kmh, 'km/h'],
    ['Bus speed', pct(a?.bus_avg_speed_kmh, b?.bus_avg_speed_kmh, true),
     a?.bus_avg_speed_kmh, b?.bus_avg_speed_kmh, 'km/h'],
    ['Time lost stopped', pct(a?.stopped_veh_hours, b?.stopped_veh_hours, false),
     a?.stopped_veh_hours, b?.stopped_veh_hours, 'veh·h'],
    ['Trips completed', pct(a?.completed, b?.completed, true),
     a?.completed, b?.completed, ''],
  ]

  return (
    <div className={`ai-toggle glass ${compact ? "compact" : ""}`}>
      <div className="ai-switch" role="group" aria-label="Signal control">
        {['baseline', 'ai'].map((k) => (
          <button
            key={k}
            className={`ai-btn ${focus === k ? 'on' : ''}`}
            onClick={() => choose(k)}
            disabled={busy}
          >
            {k === 'ai' ? 'AI-adaptive' : 'Fixed-time'}
          </button>
        ))}
      </div>

      <div className="ai-note">
        {REPLAY_ONLY
          ? 'Two pre-recorded twins on identical demand. This switches which recording plays; nothing is being decided live.'
          : 'Both twins run continuously on identical demand. This switches which one the map draws.'}
      </div>

      {twins && !compact ? (
        <div className="ai-stats">
          {rows.map(([label, d, ai, base, unit]) => (
            <div className="ai-row" key={label}>
              <span className="ai-label">{label}</span>
              <span className="ai-pair">
                <b className="base">{base == null ? '–' : base.toFixed(unit ? 1 : 0)}</b>
                <i>→</i>
                <b className="ai">{ai == null ? '–' : ai.toFixed(unit ? 1 : 0)}</b>
              </span>
              <span className={`ai-delta ${d ? (d.good ? 'good' : 'bad') : ''}`}>
                {d ? `${d.value > 0 ? '+' : ''}${d.value.toFixed(1)}%` : '–'}
              </span>
            </div>
          ))}
          {twins.sim_time_drift_pct != null && (
            <div className="ai-drift">
              clocks differ by {twins.sim_time_drift_pct}% ·
              {' '}favours {twins.drift_favours}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
