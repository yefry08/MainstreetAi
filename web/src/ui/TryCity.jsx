import { useEffect, useState } from 'react'

/**
 * "Try your city": a fixed list of districts, not a free-text box.
 *
 * WHY A LIST
 * Typing a city name implies the pipeline will run on demand. It cannot. A
 * district needs a prettymaps bake (Shibuya took 8.8 minutes; Barcelona's full
 * extent took 26) and, for traffic, a SUMO network build on top. A text box
 * would accept "Tokyo", appear to work, and hang.
 *
 * WHY DISTRICTS AND NOT CITIES
 * The bake scales linearly with area and SUMO's step time scales with vehicle
 * count -- already below realtime at 3,100 vehicles on one core. A
 * neighbourhood keeps the graph small enough that every signalised junction on
 * screen is one the controller is actually orchestrating.
 *
 * WHAT IS HONEST HERE
 * A district with a basemap but no SUMO network renders the illustration and
 * no traffic. That is reported as "map only", because an empty city presented
 * as a quiet one is the kind of thing a demo should never do.
 */
export default function TryCity({ current, onSelect }) {
  const [reg, setReg] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let alive = true
    fetch('./api/districts')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch(() => fetch('./districts.json').then((r) => r.json()))
      .then((d) => alive && setReg(d))
      .catch((e) => alive && setErr(e.message))
    return () => { alive = false }
  }, [])

  if (err) {
    return (
      <div className="try-page">
        <p className="try-error">District registry unavailable: {err}</p>
      </div>
    )
  }
  if (!reg?.districts) {
    return <div className="try-page"><p className="try-note">Loading districts…</p></div>
  }

  return (
    <div className="try-page">
      <header className="try-head">
        <h1>Try your city</h1>
        <p>
          The same pipeline — street graph, illustrated basemap, pixel traffic —
          scoped to a district rather than a metro area. Small enough that the
          graph stays responsive and every signal on screen is one the
          controller is orchestrating.
        </p>
      </header>

      <div className="try-grid">
        {reg.districts.map((d) => {
          const state = d.has_network ? 'ready' : (d.has_basemap ? 'map' : 'unbuilt')
          return (
            <button
              key={d.key}
              className={`try-card ${current === d.key ? 'on' : ''} ${state}`}
              onClick={() => (d.has_basemap ? onSelect?.(d.key) : null)}
              disabled={!d.has_basemap}
            >
              <div className="try-card-top">
                <span className="try-city">{d.city}</span>
                <span className={`try-state ${state}`}>
                  {state === 'ready' ? 'traffic + map'
                    : state === 'map' ? 'map only' : 'not built'}
                </span>
              </div>
              <div className="try-name">{d.name}</div>
              <div className="try-meta">
                {d.km[0].toFixed(1)} × {d.km[1].toFixed(1)} km · {d.area_km2} km²
              </div>
              <p className="try-why">{d.why}</p>
            </button>
          )
        })}
      </div>

      <p className="try-note">
        “Map only” means the illustrated basemap is baked but the SUMO network
        for that district is not, so it renders without traffic. Building the
        traffic side is a separate multi-minute pipeline per district — it is
        not something that can happen while you wait.
      </p>
    </div>
  )
}
