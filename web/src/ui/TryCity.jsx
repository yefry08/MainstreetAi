import { useEffect, useState } from 'react'
import CityIllustration from './CityIllustration'

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
 * Barcelona is the working demo and opens the pixel scene. Every other city is
 * an illustrated card -- an isometric drawing of its character, not a map and
 * not a simulation -- wearing a badge that says the real thing is still being
 * built. A drawing that admits to being a drawing beats a map that half works.
 *
 * The live-map path (baked basemaps, GeoLibre links) is kept in the codebase
 * but taken out of this render path deliberately; see the git history for the
 * measurements that ruled it out.
 */

/** The cities this section presents, in this order.
 *
 *  San Francisco alone. Barcelona's card was removed: it duplicated the Home
 *  hero, and selecting it was a no-op because Barcelona is already the default
 *  district. Every other city stays in the registry -- Shibuya, Manhattan and
 *  Barcelona have real simulations -- and returns to this grid when it has a
 *  drawing worth showing.
 *
 *  The isDemo branch below is kept deliberately even though nothing takes it
 *  today: it is how a city with a working simulation gets a live card instead
 *  of an illustration, and it is the section's only path back to one. */
const SHOWN = ['sf_downtown']
const OSS = [
  {
    name: 'GeoLibre',
    href: 'https://github.com/opengeos/GeoLibre',
    role: 'adjacent',
    what: 'A browser GIS app — MapLibre, deck.gl and DuckDB-WASM — for ' +
          'exploring geospatial data. It does not fetch OpenStreetMap street ' +
          'graphs or run traffic, so it replaces nothing in this pipeline; it ' +
          'is a good place to open a district’s street network and look ' +
          'around, and it is credited here for that, not used.',
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

/**
 * GeoLibre opens a plain GeoJSON by URL, so "explore this district" is a link,
 * not an iframe. An iframe was measured and rejected: the viewer's entry
 * scripts alone are 1.6 MB compressed -- nearly twice this site's whole first
 * load -- before deck.gl and DuckDB-WASM arrive, and none of it can be made
 * faster from here. A new tab costs the visitor nothing until they ask.
 *
 * The URL must be absolute: GeoLibre fetches it from its own origin.
 */
const roadsUrl = (d) => {
  const file = d.key === 'barcelona' ? 'data/roads.geojson' : `data/roads_${d.key}.geojson`
  return new URL(file, document.baseURI).href
}
const geolibreUrl = (d) =>
  `https://web.geolibre.app/?data=${encodeURIComponent(roadsUrl(d))}&embed=maponly`

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
        {SHOWN.map((k) => reg.districts.find((d) => d.key === k)).filter(Boolean).map((d) => {
          const isDemo = d.key === 'barcelona'
          const state = isDemo ? 'ready' : 'card'
          return (
            <div className="try-card-wrap" key={d.key}>
            <button
              className={`try-card ${current === d.key ? 'on' : ''} ${state}`}
              onClick={() => (isDemo ? onSelect?.(d.key) : null)}
              aria-disabled={!isDemo}
            >
              <div className="try-card-top">
                <span className="try-city">{d.city}</span>
                <span className={`try-state ${state}`}>
                  {isDemo ? 'traffic + map · live demo' : 'illustrated'}
                </span>
              </div>
              <div className="try-name">{d.name}</div>
              <div className="try-meta">
                {d.km[0].toFixed(1)} × {d.km[1].toFixed(1)} km · {d.area_km2} km²
              </div>
              <p className="try-why">{d.why}</p>

              {/* The drawing, where one exists. It is the card's content, not
                  decoration: the city's character at a glance. */}
              {!isDemo && <CityIllustration district={d.key} />}
            </button>

            {/* Not a modal, not a disabled overlay: a pill in the corner that
                says plainly the simulation for this city is still being built.
                The card should look intentional, not broken. */}
            {!isDemo && (
              <span className="try-badge">
                <i aria-hidden="true" />In progress behind the scenes
              </span>
            )}
            </div>
          )
        })}
      </div>

      <p className="try-note">
        Barcelona runs the full simulation. The other cities are illustrated
        cards for now — a drawing of each district's character, not a map —
        while their networks are built. Each one is a multi-minute pipeline per
        district, not something that can happen while you wait.
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
