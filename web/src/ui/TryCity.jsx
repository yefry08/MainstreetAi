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
const OSS = [
  {
    name: 'GeoLibre',
    href: 'https://github.com/opengeos/GeoLibre',
    role: 'adjacent',
    what: 'A cloud-native GIS platform for exploring geospatial data in the ' +
          'browser, on desktop and in notebooks. Built on MapLibre, the same ' +
          'renderer as the 3D scene here — a good starting point for anyone ' +
          'wanting to work with their own city’s data.',
    used: false,
  },
  {
    name: 'SUMO',
    href: 'https://eclipse.dev/sumo/',
    role: 'simulation',
    what: 'Eclipse SUMO runs both twins — the vehicle-following model, the ' +
          'signal programs and every metric quoted on this site.',
    used: true,
  },
  {
    name: 'OpenStreetMap',
    href: 'https://www.openstreetmap.org/copyright',
    role: 'street data',
    what: 'Every street, lane count, one-way rule and signal position comes ' +
          'from OSM, via Overpass. © OpenStreetMap contributors, ODbL.',
    used: true,
  },
  {
    name: 'prettymaps',
    href: 'https://github.com/marceloprates/prettymaps',
    role: 'illustrated basemap',
    what: 'Bakes the flat-colour maps the pixel districts are drawn over.',
    used: true,
  },
  {
    name: 'MapLibre GL JS',
    href: 'https://maplibre.org/',
    role: 'basemap rendering',
    what: 'Carries the 3D scene’s basemap and camera.',
    used: true,
  },
]

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

              {/* Traffic runs on the card only where traffic actually exists.
                  Animating the map-only districts would look better and say
                  something false -- the stillness is the honest signal, and it
                  reads faster than the label does. */}
              {state === 'ready' && (
                <div className="try-traffic" aria-hidden="true">
                  <span className="try-road" />
                  <i className="try-car c1" /><i className="try-car c2" />
                  <i className="try-car c3" />
                </div>
              )}
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

      {/* Credit, not a dependency list. Only tools this pipeline genuinely
          uses are named as such; GeoLibre is flagged as adjacent, because
          claiming it as a component of a build it has no part in would be the
          same misrepresentation the Research page is careful to avoid. */}
      <section className="try-oss">
        <h2>Open source behind this</h2>
        <ul className="try-oss-list">
          {OSS.map((o) => (
            <li key={o.name} className={o.used ? 'used' : 'adjacent'}>
              <a href={o.href} target="_blank" rel="noopener noreferrer">
                {o.name}
              </a>
              <span className="try-oss-role">{o.role}</span>
              <span className="try-oss-what">{o.what}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
