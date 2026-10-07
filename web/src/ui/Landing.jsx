import { Suspense, lazy, useEffect, useState } from 'react'
import { assetUrl } from '../data/assetUrl'

// Lazy: three.js scene setup should not hold up the headline. The text paints
// first and the city arrives a moment later.
const HeroCity = lazy(() => import('./HeroCity'))

/**
 * The landing page: what MainstreetAi is, what it found, and where to look.
 *
 * NUMBERS ARE READ, NOT TYPED
 * The Barcelona and Manhattan figures come from the recordings' own manifests
 * at load time -- the same stats the impact panel quotes beside the running
 * scene. Typing them in here would mean the page goes on claiming the old
 * result the first time a city is re-recorded, which has already happened
 * once (Manhattan, after its signal fix). If a manifest cannot be read the
 * card says so rather than showing a stale or invented number.
 *
 * The any-city figures are the exception: they come from
 * src/city/controller.bench.mjs (37 cities x 3 seeds), not from a file the
 * page ships. Re-run the bench and update ANY_CITY if the controller changes.
 */
const ANY_CITY = { cities: 37, improved: 27, meanStopped: -19 }

const CITIES = [
  {
    key: 'home', name: 'Barcelona', where: 'Eixample, Spain', dir: 'replay',
    blurb: 'Cerdà’s grid of chamfered blocks: 3,230 signalised approaches, with traffic demand shaped by the city’s own published traffic data.',
  },
  {
    key: 'manhattan', name: 'Manhattan', where: 'Midtown, New York', dir: 'replay_manhattan',
    blurb: 'A near-perfect grid with avenue-length green waves, the textbook case for signal coordination. 5,598 buildings at surveyed height.',
  },
]

function useResult(dir) {
  const [r, setR] = useState(null)
  useEffect(() => {
    let alive = true
    fetch(assetUrl(`${dir}/manifest.json`))
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.status))))
      .then((m) => {
        const a = m.stats?.ai
        const b = m.stats?.baseline
        if (!a || !b) throw new Error('no stats')
        const pct = (k) => (b[k] ? ((a[k] - b[k]) / b[k]) * 100 : null)
        if (alive) setR({
          speed: pct('avg_speed_kmh'),
          stopped: pct('stopped_veh_hours'),
          bus: pct('bus_avg_speed_kmh'),
          co2: pct('co2_kg'),
        })
      })
      .catch(() => { if (alive) setR({ error: true }) })
    return () => { alive = false }
  }, [dir])
  return r
}

const fmt = (v) => (v == null ? '–' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}%`)

function CityCard({ city, onTab }) {
  const r = useResult(city.dir)
  return (
    <article className="land-card glass">
      <p className="land-card-where">{city.where}</p>
      <h3>{city.name}</h3>
      <p className="land-card-blurb">{city.blurb}</p>
      {r?.error ? (
        <p className="land-card-missing">Result unavailable — open the city to see it live.</p>
      ) : (
        <dl className="land-stats">
          <div><dt>Average speed</dt><dd className="good">{r ? fmt(r.speed) : '…'}</dd></div>
          <div><dt>Time stopped</dt><dd className="good">{r ? fmt(r.stopped) : '…'}</dd></div>
          <div><dt>Bus speed</dt><dd className="good">{r ? fmt(r.bus) : '…'}</dd></div>
          <div><dt>CO₂</dt><dd className="good">{r ? fmt(r.co2) : '…'}</dd></div>
        </dl>
      )}
      <button className="land-btn" onClick={() => onTab(city.key)}>
        Watch {city.name} in 3D →
      </button>
    </article>
  )
}

export default function Landing({ onTab }) {
  return (
    <div className="land">
      <section className="land-hero">
        <div className="land-hero-text">
          <p className="land-eyebrow">Adaptive traffic signals · real cities · digital twins</p>
          <h1>Same streets. Same traffic.<br />Smarter traffic lights.</h1>
          <p className="land-lede">
            MainstreetAi runs two identical simulations of a real city side by
            side. One keeps today’s fixed signal timings. In the other, AI reads
            the queues at every junction and retimes the lights. Everything else
            is held equal, so the difference you see is the signals and nothing else.
          </p>
          <div className="land-cta">
            <button className="land-btn primary" onClick={() => onTab('home')}>Watch Barcelona</button>
            <button className="land-btn" onClick={() => onTab('yours')}>Try your own city</button>
            <button className="land-btn ghost" onClick={() => onTab('how')}>How it works</button>
          </div>
        </div>
        <figure className="land-hero-city">
          <Suspense fallback={<div className="land-city" />}><HeroCity /></Suspense>
          <figcaption>
            Live: a real simulation with adaptive signals. <span className="land-dot" /> stopped cars
          </figcaption>
        </figure>
      </section>

      <section className="land-section">
        <h2>What the twins found</h2>
        <p className="land-sub">
          AI-timed signals against fixed timing, on the same simulated traffic.
          Figures come from the recorded runs shown in each city.
        </p>
        <div className="land-grid">
          {CITIES.map((c) => <CityCard key={c.key} city={c} onTab={onTab} />)}
          <article className="land-card glass">
            <p className="land-card-where">Anywhere</p>
            <h3>Your city</h3>
            <p className="land-card-blurb">
              Search any place. Its real streets and traffic lights load from
              OpenStreetMap, and a built-in adaptive controller runs in your
              browser. No account, no key.
            </p>
            <dl className="land-stats">
              <div><dt>Cities tested</dt><dd>{ANY_CITY.cities}</dd></div>
              <div><dt>Less time stopped</dt><dd className="good">{ANY_CITY.improved} of {ANY_CITY.cities}</dd></div>
              <div><dt>Mean change</dt><dd className="good">{fmt(ANY_CITY.meanStopped)}</dd></div>
              <div><dt>Made worse</dt><dd>0</dd></div>
            </dl>
            <button className="land-btn" onClick={() => onTab('yours')}>Analyse a city →</button>
          </article>
        </div>
      </section>

      <section className="land-section">
        <h2>How it works</h2>
        <ol className="land-steps">
          <li>
            <span className="land-step-n">01</span>
            <h3>Real streets</h3>
            <p>Roads, lanes, speed limits and traffic-light positions come from OpenStreetMap, not from a model.</p>
          </li>
          <li>
            <span className="land-step-n">02</span>
            <h3>Two identical twins</h3>
            <p>The same vehicles enter the same network from the same seed. Only the signal controller differs.</p>
          </li>
          <li>
            <span className="land-step-n">03</span>
            <h3>AI times the lights</h3>
            <p>It moves green time towards the longer queues while keeping each cycle the same length, and the result is measured, not asserted.</p>
          </li>
        </ol>
        <button className="land-btn ghost" onClick={() => onTab('how')}>See it step by step →</button>
      </section>

      <footer className="land-foot">
        <p>
          <b>A simulation, said plainly.</b> Barcelona and Manhattan run in SUMO,
          the open-source traffic simulator used in research. Your city runs a
          simpler model in the browser. Results show how adaptive timing behaves
          on each network; they are not a forecast of real-world traffic.
        </p>
        <p className="land-links">
          <button onClick={() => onTab('research')}>Research</button>
          <span aria-hidden="true">·</span>
          <button onClick={() => onTab('contact')}>Contact</button>
        </p>
      </footer>
    </div>
  )
}
