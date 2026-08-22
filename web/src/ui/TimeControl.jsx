import { useEffect, useState } from 'react'
import { postControl } from '../data/useSimSocket'

/**
 * Day and peak selection, driven by MEASURED Barcelona traffic.
 *
 * The three peak buttons are not hours someone chose because they sounded
 * right — they are read from `/api/profile`, which is built from 3.24 million
 * observations of the city's own traffic-state feed. On a Friday the morning
 * peak lands at 08:00 because that is when Barcelona's morning peak lands.
 *
 * The sparkline under the buttons is the same measured curve, so you can see
 * the shape you are selecting a point on rather than trusting a label.
 */

const DAYS = [
  ['Monday', 'Mon'], ['Tuesday', 'Tue'], ['Wednesday', 'Wed'],
  ['Thursday', 'Thu'], ['Friday', 'Fri'], ['Saturday', 'Sat'],
  ['Sunday', 'Sun'],
]

const PEAKS = [
  ['morning', 'Morning'],
  ['afternoon', 'Afternoon'],
  ['evening', 'Evening'],
]

export default function TimeControl({ header }) {
  const [profile, setProfile] = useState(null)
  const [day, setDay] = useState('Friday')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/profile')
      .then((r) => (r.ok ? r.json() : null))
      .then(setProfile)
      .catch(() => setProfile(null))
  }, [])

  useEffect(() => {
    if (header?.day) setDay(header.day)
  }, [header?.day])

  if (!profile) return null

  const curve = profile.demand_by_day?.[day] || profile.demand_weekday_mean || []
  const peaks = profile.peaks?.[day] || profile.weekday_peaks || {}
  const clockHour = parseInt((header?.clock || '00:00').slice(0, 2), 10)

  const go = async (nextDay, hour) => {
    setBusy(true)
    setDay(nextDay)
    await postControl('clock', undefined, { day: nextDay, hour })
    setTimeout(() => setBusy(false), 600)
  }

  return (
    <section className={`glass panel timectl ${busy ? 'busy' : ''}`}>
      <header className="panel-head">
        <h2>Day &amp; peak</h2>
        <span className="panel-sub">measured</span>
      </header>

      <div className="day-row">
        {DAYS.map(([full, short]) => (
          <button
            key={full}
            className={`day-chip ${day === full ? 'on' : ''}`}
            onClick={() => go(full, peaks.morning?.hour ?? 8)}
            title={full}
          >
            {short}
          </button>
        ))}
      </div>

      {/* Measured demand curve for the selected day. */}
      <div className="spark" aria-hidden="true">
        {curve.map((v, h) => (
          <i
            key={h}
            className={h === clockHour ? 'now' : ''}
            style={{ height: `${Math.max(3, v * 100)}%` }}
            title={`${String(h).padStart(2, '0')}:00 — ${(v * 100).toFixed(0)}%`}
          />
        ))}
      </div>
      <div className="spark-axis">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
      </div>

      <div className="peak-row">
        {PEAKS.map(([key, label]) => {
          const p = peaks[key]
          if (!p) return null
          const active = clockHour === p.hour
          return (
            <button
              key={key}
              className={`peak-chip ${active ? 'on' : ''}`}
              onClick={() => go(day, p.hour)}
            >
              <span className="peak-label">{label}</span>
              <span className="peak-hour value">
                {String(p.hour).padStart(2, '0')}:00
              </span>
            </button>
          )
        })}
      </div>

      <footer className="panel-note">
        Peaks read from {(profile.source?.observations || 0).toLocaleString()}{' '}
        real observations of {profile.source?.sections || 532} Barcelona road
        sections.
      </footer>
    </section>
  )
}
