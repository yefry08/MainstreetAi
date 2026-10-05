import { useCallback, useEffect, useRef, useState } from 'react'
import { byCountry, bbox } from '../city/cities'
import { PROVIDERS, verifyKey } from '../city/ai'
import { buildGraph } from '../city/osm'
import { loadStreets } from '../city/load'
import { searchPlaces } from '../city/geocode'
import { createTwins, compare } from '../city/sim'
import { cityPalette, startOrchestrator, proportionalPolicy } from '../city/orchestrator'
import TrafficLoader from '../city/TrafficLoader'
import CityCanvas from '../city/CityCanvas'

/**
 * "Your city": analyse and improve the traffic of any city.
 *
 * WHAT CHANGED, AND WHY
 * This section existed before as a fixed list of 38 cities, and only showed an
 * improvement if the visitor brought two LLM API keys. Without keys the two
 * twins ran the same fixed programme, so the visitor saw their own streets and
 * no result -- the one thing the page is for. It was then taken off the site,
 * because it depended on Overpass and on other people's keys.
 *
 * Now:
 *   - ANY place: free search through OpenStreetMap's geocoder, beside a set of
 *     ready-made cities that ship with the site and open with no network at all
 *   - IMPROVEMENT WITH NO KEY: a built-in adaptive controller (proportional
 *     green splits, see city/orchestrator.js) runs one twin for everybody. A
 *     visitor's own model is an optional alternative controller, not a toll
 *   - ANALYSIS: the junctions where traffic queues worst under today's fixed
 *     timing, numbered on the map, with what adaptive control did at each
 *
 * WHAT THE NUMBERS MEAN -- the page says this, because overclaiming here would
 * be easy and wrong. Measured with city/controller.bench.mjs on all 37
 * ready-made cities, three seeds each: stopped time fell in 27 (all three seeds
 * agreeing), by 3-65%; in 10 the seed range spans zero; none got consistently
 * worse. Mean over all 37: stopped time -19%, average speed +1%. Where traffic
 * is light or balanced it rightly does almost nothing, and the page says that
 * too rather than presenting noise as a result. Re-run the bench and update
 * this and the copy below if the controller, deadband or demand changes.
 *
 * KEYS (optional) live in React state only: never storage, never a URL, never
 * sent anywhere but the provider chosen. This site has no backend.
 */

const DEFAULT_PALETTE = {
  ground: '#e9e3d6', roads: '#6e7078', buildings: '#c9c2b4',
  accent: '#d97757', sky: '#dceaf2', reason: '',
}

// How often the built-in controller looks at the network, in SIMULATED
// seconds -- tied to sim time so the faster playback speeds do not starve it.
const DECIDE_EVERY_S = 4
// Before this much simulated time the two twins have barely diverged and a
// percentage is mostly noise. Showing "-38%" four seconds in invites a claim
// the run has not earned yet.
const SETTLE_S = 90
const HOTSPOTS = 5

const stepsFor = (city, withLlm) => [
  { key: 'osm', label: city?.live ? 'Downloading real streets from OpenStreetMap'
                                  : 'Loading the city’s real streets' },
  { key: 'graph', label: 'Placing the city’s traffic lights from the map' },
  ...(withLlm ? [{ key: 'palette', label: 'Your model picks the city’s palette' }] : []),
  { key: 'sim', label: 'Starting the two twin simulations' },
]

export default function TryCity() {
  const [phase, setPhase] = useState('pick')         // pick | loading | running
  const [city, setCity] = useState(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)

  const [llmOn, setLlmOn] = useState(false)
  const [llm, setLlm] = useState({ provider: 'gemini', model: '', key: '' })
  const [runLlm, setRunLlm] = useState(false)

  const [stage, setStage] = useState('osm')
  const [detail, setDetail] = useState('')
  const [error, setError] = useState(null)

  const [source, setSource] = useState(null)
  const [graph, setGraph] = useState(null)
  const [palette, setPalette] = useState(DEFAULT_PALETTE)
  const [twins, setTwins] = useState(null)
  const [view, setView] = useState('ai')
  const [stats, setStats] = useState(null)
  const [hot, setHot] = useState([])
  const [ctl, setCtl] = useState({ checks: 0, retimes: 0 })
  const [aiLog, setAiLog] = useState([])
  const [speed, setSpeed] = useState(1)

  const speedRef = useRef(1)
  const abortRef = useRef(null)
  const searchAbortRef = useRef(null)
  const stopOrchRef = useRef(null)
  const rafRef = useRef(0)

  useEffect(() => { speedRef.current = speed }, [speed])

  // Everything stops when the component goes away: the simulation loop, the
  // model's timer, and any in-flight request -- including one carrying a key.
  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current)
    stopOrchRef.current?.()
    abortRef.current?.abort()
    searchAbortRef.current?.abort()
  }, [])

  const stopRun = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    stopOrchRef.current?.()
    stopOrchRef.current = null
    abortRef.current?.abort()
  }, [])

  const reset = useCallback(() => {
    stopRun()
    setPhase('pick'); setError(null)
    setGraph(null); setTwins(null); setStats(null); setHot([]); setAiLog([])
    setCtl({ checks: 0, retimes: 0 }); setPalette(DEFAULT_PALETTE); setSource(null)
  }, [stopRun])

  const search = useCallback(async (e) => {
    e?.preventDefault()
    if (query.trim().length < 2) return
    searchAbortRef.current?.abort()
    const ac = new AbortController()
    searchAbortRef.current = ac
    setSearching(true); setSearchError(null)
    try {
      setResults(await searchPlaces(query, { signal: ac.signal }))
    } catch (err) {
      if (err.name !== 'AbortError') setSearchError(err.message)
    } finally {
      setSearching(false)
    }
  }, [query])

  const launch = useCallback(async () => {
    const withLlm = llmOn && !!llm.key.trim()
    setRunLlm(withLlm)
    setPhase('loading'); setError(null); setStage('osm'); setDetail('')
    const ac = new AbortController()
    abortRef.current = ac

    try {
      // --- 1. real streets: ready-made if the site has them, else live ------
      const { osm, source: src } = await loadStreets(city, {
        signal: ac.signal, onProgress: setDetail,
      })
      setSource(src)

      // --- 2. graph and signal placement ------------------------------------
      setStage('graph'); setDetail('')
      const g = buildGraph(osm, bbox(city))
      if (g.stats.signals < 3) {
        throw new Error(`Only ${g.stats.signals} junctions with traffic lights were found ` +
          'around this point — too few for signal timing to matter. Try a denser ' +
          'city centre.')
      }
      setGraph(g)
      setDetail(`${g.stats.edges} streets · ${g.stats.signals} junctions with traffic lights`)

      // --- 3. palette, only with the visitor's model ------------------------
      if (withLlm) {
        setStage('palette')
        try {
          setPalette(await cityPalette(llm.provider, llm.key, llm.model, city, ac.signal))
        } catch (err) {
          if (err.name === 'AbortError') throw err
          // Decoration. Losing it must not cost the run.
          setAiLog((l) => [`Palette: ${err.message} — using the default.`, ...l])
          setPalette(DEFAULT_PALETTE)
        }
      } else {
        setPalette(DEFAULT_PALETTE)
      }

      // --- 4. the twins -----------------------------------------------------
      setStage('sim')
      const vehicles = Math.min(420, Math.max(90, Math.round(g.stats.km * 12)))
      const t = createTwins(g, { vehicles })
      setTwins(t)
      setView('ai')
      setPhase('running')
      setStats(compare(t))

      // Hotspot analysis: mean queue per signalised junction, sampled once a
      // simulated second in BOTH twins, so the list can show what adaptive
      // control did at exactly the places fixed timing handles worst.
      const pos = new Map(t.fixed.signals.map((s) => [s.id, s]))
      const acc = new Map()
      let samples = 0
      const sample = () => {
        samples++
        const qf = t.fixed.queues()
        const qa = t.ai.queues()
        for (const [id, q] of qf) {
          const a = acc.get(id) ?? { f: 0, a: 0 }
          a.f += q.total
          a.a += qa.get(id)?.total ?? 0
          acc.set(id, a)
        }
      }
      const topHotspots = () => [...acc.entries()]
        .map(([id, v]) => ({ id, x: pos.get(id).x, y: pos.get(id).y,
                             fixed: v.f / samples, adaptive: v.a / samples }))
        .filter((h) => h.fixed >= 0.5)
        .sort((x, y) => y.fixed - x.fixed)
        .slice(0, HOTSPOTS)

      let checks = 0
      let retimes = 0
      let sinceDecide = 0
      let sinceSample = 0
      let lastUi = 0
      let last = performance.now()

      const loop = () => {
        const now = performance.now()
        const dt = Math.min(0.4, (now - last) / 1000)
        last = now
        for (let i = 0; i < speedRef.current; i++) {
          t.fixed.step(dt)
          t.ai.step(dt)
          sinceSample += dt
          if (sinceSample >= 1) { sinceSample = 0; sample() }
          // Built-in controller, unless the visitor's model has the job.
          if (!withLlm) {
            sinceDecide += dt
            if (sinceDecide >= DECIDE_EVERY_S) {
              sinceDecide = 0
              checks++
              retimes += proportionalPolicy(t.ai).applied
            }
          }
        }
        // React is updated a few times a second, not every frame: the numbers
        // cannot be read at 60 Hz anyway, and re-rendering the panel that often
        // costs the simulation frames on a slow machine.
        if (now - lastUi > 300) {
          lastUi = now
          setStats(compare(t))
          if (samples) setHot(topHotspots())
          if (!withLlm) setCtl({ checks, retimes })
        }
        rafRef.current = requestAnimationFrame(loop)
      }
      rafRef.current = requestAnimationFrame(loop)

      if (withLlm) {
        stopOrchRef.current = startOrchestrator({
          world: t.ai,
          provider: llm.provider, key: llm.key, model: llm.model,
          onTick: (r) => {
            if (!r.error) setCtl((c) => ({ checks: c.checks + 1, retimes: c.retimes + r.applied }))
            setAiLog((l) => [
              r.halted ? `Stopped after repeated errors: ${r.error}`
                : r.error ? `Error: ${r.error}`
                : r.considered ? `Retimed ${r.applied} of the ${r.considered} most unbalanced junctions.`
                : 'No junction unbalanced enough to act on — timings left as they are.',
              ...l,
            ].slice(0, 6))
          },
        })
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message)
    }
  }, [city, llm, llmOn])

  // ---------------------------------------------------------------- loading
  if (phase === 'loading' || (phase === 'running' && error)) {
    return (
      <div className="try-page">
        <TrafficLoader
          stage={stage} steps={stepsFor(city, runLlm)}
          detail={detail} error={error}
          onRetry={launch} onCancel={reset}
        />
      </div>
    )
  }

  // ---------------------------------------------------------------- running
  if (phase === 'running' && twins && graph && stats) {
    const world = view === 'ai' ? twins.ai : twins.fixed
    const simTime = stats.fixed.simTime
    const settled = simTime >= SETTLE_S
    const s = graph.stats
    const quiet = settled && simTime > 180 && ctl.retimes < 5

    return (
      <div className="try-run" style={{ '--city-accent': palette.accent }}>
        <div className="try-run-head">
          <div>
            <h1>{city.flag ?? '📍'} {city.name}</h1>
            <p className="try-run-sub">
              {s.edges} streets · {s.signals} of {s.junctions} junctions with traffic lights ·
              {' '}{world.fleet.length} vehicles ·
              {' '}<span className="try-source">{source === 'ready-made' ? 'ready-made streets' : 'streets downloaded live'}</span>
            </p>
          </div>
          <div className="try-run-actions">
            <div className="try-switch" role="group" aria-label="Which twin to show">
              {[['fixed', 'Today: fixed timing'], ['ai', runLlm ? 'Your model' : 'Adaptive']].map(([k, label]) => (
                <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{label}</button>
              ))}
            </div>
            <div className="try-switch" role="group" aria-label="Simulation speed">
              {[1, 4, 10].map((n) => (
                <button key={n} className={speed === n ? 'on' : ''} onClick={() => setSpeed(n)}>{n}×</button>
              ))}
            </div>
            <button className="tl-btn" onClick={reset}>Another city</button>
          </div>
        </div>

        <CityCanvas graph={graph} world={world} palette={palette} running hotspots={hot} />

        <p className="try-clock">
          Simulated {fmtTime(simTime)}
          {!settled && ' · measuring — the comparison settles after about a minute and a half'}
        </p>

        <div className="try-metrics">
          <Metric label="Time spent stopped" unit=" min" settled={settled} d={stats.stopped}
                  a={stats.ai.stoppedVehSeconds / 60} b={stats.fixed.stoppedVehSeconds / 60} />
          <Metric label="Average speed" unit=" km/h" settled={settled} d={stats.avgSpeed}
                  a={stats.ai.avgSpeedKmh} b={stats.fixed.avgSpeedKmh} digits={1} />
          <Metric label="Junctions crossed" unit="" settled={settled} d={stats.arrivals}
                  a={stats.ai.arrivals} b={stats.fixed.arrivals} />
        </div>

        <div className="try-analysis">
          <section className="try-hot">
            <h2>Where traffic queues worst today</h2>
            {hot.length ? (
              <ol>
                {hot.map((h) => (
                  <li key={h.id}>
                    Average queue <b className="base">{h.fixed.toFixed(1)}</b>
                    {' '}<i aria-label="becomes">→</i>{' '}
                    <b className="ai">{h.adaptive.toFixed(1)}</b> vehicles
                  </li>
                ))}
              </ol>
            ) : <p>Collecting queue data…</p>}
            <p className="try-hot-note">
              Numbered on the map. Left: fixed timing, as the city runs now.
              Right: the same junction under {runLlm ? 'your model' : 'adaptive control'}.
            </p>
          </section>

          <section className="try-ctl">
            <h2>{runLlm ? `Controller: your model (${PROVIDERS[llm.provider].label})` : 'Controller: built-in adaptive'}</h2>
            <p>
              {runLlm ? 'Reads the queue on each arm of the busiest junctions and returns new green times.'
                : 'Every few seconds it finds junctions with a real imbalance between their two directions and moves green time towards the longer queue, keeping each cycle the same length.'}
            </p>
            <p className="try-ctl-count">{ctl.retimes} {ctl.retimes === 1 ? 'retiming' : 'retimings'} · {ctl.checks} {ctl.checks === 1 ? 'check' : 'checks'}</p>
            {quiet && (
              <p className="try-ctl-quiet">
                Little to fix here. Traffic at these junctions is light or evenly
                balanced, so the controller is mostly leaving timings alone --
                which is the right call, and why the numbers above barely move.
              </p>
            )}
            {runLlm && aiLog.length > 0 && <ul>{aiLog.map((l, i) => <li key={i}>{l}</li>)}</ul>}
          </section>
        </div>

        {s.estimatedSignals && (
          <p className="try-warn">
            OpenStreetMap has almost no traffic lights mapped here, so their
            positions are <b>estimated</b> (every junction of three or more
            streets). Treat this run as illustrative of the method rather than
            of this city’s actual signals.
          </p>
        )}

        <p className="try-note">
          <b>What is real.</b> The streets, their lanes, speed limits and one-way
          rules, and where the traffic lights are, all come from OpenStreetMap
          (© OpenStreetMap contributors, ODbL). Both twins carry the same vehicles
          on the same streets from the same seed; the only difference is who
          times the lights.
        </p>
        <p className="try-note">
          <b>What is simplified.</b> Vehicles follow random routes rather than
          measured trips, so this shows how adaptive timing behaves on this
          city’s network, not a forecast of its real traffic. Measured on all
          37 ready-made cities, three runs each: time spent stopped fell in
          27 of them, by 3% to 65%; in the other 10 the change was within
          noise, because there was too little unbalanced traffic to act on.
          It made no city measurably worse. Average speed barely moves (+1%
          on average) — most of a trip is driving, not waiting at a light.
        </p>
      </div>
    )
  }

  // ------------------------------------------------------------ the picker
  return (
    <div className="try-page">
      <header className="try-head">
        <h1>Your city</h1>
        <p>
          Pick any city. MainstreetAi loads its real streets and traffic lights,
          runs two identical traffic simulations, and lets an adaptive controller
          time the lights in one of them — so you can see where traffic queues
          and how much adaptive signal timing helps. No account and no key needed.
        </p>
      </header>

      <section className="try-step">
        <h2>Search for a place</h2>
        <form className="try-search" onSubmit={search}>
          <input
            type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="City, district or address — e.g. Valencia, Medellín, Shibuya"
            aria-label="Search for a place" autoComplete="off" />
          <button className="tl-btn" type="submit" disabled={searching || query.trim().length < 2}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>
        {searchError && <p className="try-search-error">{searchError}</p>}
        {results && (
          results.length ? (
            <ul className="try-results">
              {results.map((r) => (
                <li key={`${r.lat},${r.lon}`}>
                  <button className={city === r ? 'on' : ''} onClick={() => setCity(r)}>
                    <b>{r.name}</b><span>{r.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="try-search-error">No places found for “{query}”.</p>
        )}
        <p className="try-fine">
          Search uses OpenStreetMap’s Nominatim; only the text you type is sent.
          The area analysed is about 2.5 km across, centred on the place you pick.
        </p>
      </section>

      <section className="try-step">
        <h2>Or open a ready-made city <em>instant, works offline</em></h2>
        <div className="try-chips">
          {byCountry().flatMap((c) => c.cities).map((c) => (
            <button key={c.name} className={`try-chip ${city === c ? 'on' : ''}`}
                    onClick={() => setCity(c)}>
              <span className="flag">{c.flag}</span>{c.name}
            </button>
          ))}
        </div>
      </section>

      <section className="try-step">
        <details className="try-byo" open={llmOn}>
          <summary onClick={(e) => { e.preventDefault(); setLlmOn((v) => !v) }}>
            Use your own AI model as the controller <em>optional</em>
          </summary>
          <p className="try-keynote">
            <b>Your key is not stored.</b> It lives only in this tab’s memory and
            goes straight from your browser to the provider you pick — this site
            is static and has no server of its own. Use a key with a spending
            limit: it is the one protection that does not depend on trusting us.
          </p>
          <KeyCard
            title="Signal controller"
            what="Your model reads the queues at the busiest junctions and returns green times, in place of the built-in controller. It also picks the city's colours."
            cfg={llm} onChange={setLlm} />
        </details>
      </section>

      <div className="try-go glass">
        <div>
          <b>{city ? `${city.flag ?? '📍'} ${city.name}` : 'No city selected yet'}</b>
          <span>
            {!city ? 'Search for a place or pick a ready-made city.'
              : city.live ? `${city.label}. Its streets are downloaded live from OpenStreetMap, which can take up to a minute.`
              : 'Ready-made: opens instantly.'}
            {city && llmOn && llm.key.trim() && ' Controller: your model.'}
          </span>
        </div>
        <button className="tl-btn primary" disabled={!city} onClick={launch}>
          Analyse traffic
        </button>
      </div>
    </div>
  )
}

function fmtTime(s) {
  const m = Math.floor(s / 60)
  return `${m}m ${String(Math.floor(s % 60)).padStart(2, '0')}s`
}

function KeyCard({ title, what, cfg, onChange }) {
  const [state, setState] = useState(null)     // null | checking | ok | bad
  const p = PROVIDERS[cfg.provider]

  const test = async () => {
    setState('checking')
    try {
      setState(await verifyKey(cfg.provider, cfg.key, cfg.model || p.models[0]) ? 'ok' : 'bad')
    } catch {
      setState('bad')
    }
  }

  return (
    <div className="try-key glass">
      <h3>{title}</h3>
      <p className="try-key-what">{what}</p>

      <div className="try-key-row">
        <select value={cfg.provider} aria-label="Provider"
                onChange={(e) => { onChange({ ...cfg, provider: e.target.value, model: '' }); setState(null) }}>
          {Object.entries(PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={cfg.model || p.models[0]} aria-label="Model"
                onChange={(e) => onChange({ ...cfg, model: e.target.value })}>
          {p.models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <div className="try-key-row">
        {/* type=password so the key is not readable over a shoulder or in a
            screen share; autoComplete off so the browser never offers to keep
            it. */}
        <input type="password" autoComplete="off" spellCheck="false" aria-label="API key"
               placeholder={`API key (${p.hint})`}
               value={cfg.key}
               onChange={(e) => { onChange({ ...cfg, key: e.target.value }); setState(null) }} />
        <button className="tl-btn" disabled={!cfg.key.trim() || state === 'checking'} onClick={test}>
          {state === 'checking' ? 'Testing…' : 'Test'}
        </button>
      </div>

      <p className="try-key-foot">
        {state === 'ok' && <span className="ok">✓ The key works</span>}
        {state === 'bad' && <span className="bad">✗ This key could not be used</span>}
        {!state && <a href={p.keys} target="_blank" rel="noopener noreferrer">Get a {p.label} key ↗</a>}
      </p>
    </div>
  )
}

function Metric({ label, d, a, b, unit, settled, digits = 0 }) {
  const fmt = (v) => (v == null ? '–' : v.toFixed(digits))
  return (
    <div className="try-metric">
      <span className="try-metric-label">{label}</span>
      <span className="try-metric-pair">
        <b className="base">{fmt(b)}{unit}</b><i>→</i><b className="ai">{fmt(a)}{unit}</b>
      </span>
      <span className={`try-metric-delta ${settled && d ? (d.good ? 'good' : 'bad') : ''}`}>
        {!settled ? '…' : d ? `${d.value > 0 ? '+' : ''}${d.value.toFixed(1)}%` : '–'}
      </span>
    </div>
  )
}
