import { useCallback, useEffect, useRef, useState } from 'react'
import { bbox, byRegion, citySlug } from '../city/cities'
import { SITE_CITIES } from '../site'
import { assetUrl } from '../data/assetUrl'
import { parsePlaceParam, placeParam } from '../data/route'
import { PROVIDERS, verifyKey } from '../city/ai'
import { buildGraph } from '../city/osm'
import { loadStreets } from '../city/load'
import { searchPlaces } from '../city/geocode'
import { createTwins, compare } from '../city/sim'
import { cityPalette, startOrchestrator, proportionalPolicy } from '../city/orchestrator'
import { neuralPolicy } from '../city/neural'
import { loadSignalModel } from '../city/signalModel'
import { LIVE_TRAFFIC, liveTraffic, vehiclesFor } from '../city/liveTraffic'
import TrafficLoader from '../city/TrafficLoader'
import CityCanvas from '../city/CityCanvas'
import CityScene3D from '../city/CityScene3D'
import { useT } from '../i18n'

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
 * be easy and wrong. Rule-based controller, measured with
 * city/controller.bench.mjs on all 37 ready-made cities, three seeds each,
 * after the amber fix in sim.js: stopped time fell in 24 (all three seeds
 * agreeing); in 13 the seed range spans zero; none got consistently worse.
 * Mean: stopped time -16%, average speed +1%. (Before the amber fix it read
 * 27 / -19%: the old physics let any controller skip ambers.) The neural
 * controller's figures come from its own model file, measured on held-out
 * cities -- see NeuralBlurb and training/train.py. Where traffic
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

const stepsFor = (city, withLlm, tr) => [
  { key: 'osm', label: city?.live ? tr('Downloading real streets from OpenStreetMap', 'Descargando las calles reales de OpenStreetMap')
                                  : tr('Loading the city’s real streets', 'Cargando las calles reales de la ciudad') },
  { key: 'graph', label: tr('Placing the city’s traffic lights from the map', 'Colocando los semáforos de la ciudad según el mapa') },
  ...(LIVE_TRAFFIC ? [{ key: 'live', label: tr('Reading live traffic on these streets', 'Leyendo el tráfico en vivo de estas calles') }] : []),
  ...(withLlm ? [{ key: 'palette', label: tr('Your model picks the city’s palette', 'Tu modelo elige los colores de la ciudad') }] : []),
  { key: 'sim', label: tr('Starting the two twin simulations', 'Arrancando las dos simulaciones gemelas') },
]

const REGION_ES = {
  'Latin America': 'América Latina', 'North America': 'Norteamérica', 'Europe': 'Europa',
  'Asia & Oceania': 'Asia y Oceanía', 'Africa': 'África',
}

// What goes in the address for a city: its slug if ready-made, else its
// coordinates and name.
const paramFor = (c) => (c.live ? placeParam(c) : citySlug(c))

export default function TryCity({ cityParam = null, onCityParam }) {
  const tr = useT()
  const [phase, setPhase] = useState('pick')         // pick | loading | running
  const [city, setCity] = useState(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)

  const [llmOn, setLlmOn] = useState(false)
  const [llm, setLlm] = useState({ provider: 'gemini', model: '', key: '' })
  const [runLlm, setRunLlm] = useState(false)

  // The trained neural controller: undefined while loading, null if neither
  // Hugging Face nor the site copy could provide a valid model.
  const [nn, setNn] = useState(undefined)
  const [useNeural, setUseNeural] = useState(true)
  const [runNeural, setRunNeural] = useState(false)

  // Which ready-made cities really exist (public/cities/index.json). Only
  // those are offered as "instant, works offline": a city whose bake failed
  // would otherwise make that promise and quietly fall back to a live
  // download. null while loading; false if there is no index, in which case
  // the whole catalogue is shown and the loader falls back per city.
  const [ready, setReady] = useState(null)
  useEffect(() => {
    let alive = true
    fetch(assetUrl('cities/index.json'))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive) setReady(j?.cities ? new Map(j.cities.map((c) => [c.slug, c])) : false) })
      .catch(() => { if (alive) setReady(false) })
    return () => { alive = false }
  }, [])
  const readyCities = ready ? SITE_CITIES.filter((c) => ready.has(citySlug(c)))
    : ready === false ? SITE_CITIES : []
  useEffect(() => {
    let alive = true
    loadSignalModel().then((r) => { if (alive) setNn(r) })
    return () => { alive = false }
  }, [])

  const [stage, setStage] = useState('osm')
  const [detail, setDetail] = useState('')
  const [error, setError] = useState(null)

  const [source, setSource] = useState(null)
  const [graph, setGraph] = useState(null)
  const [palette, setPalette] = useState(DEFAULT_PALETTE)
  const [twins, setTwins] = useState(null)
  const [live, setLive] = useState(null)
  const [view, setView] = useState('ai')
  const [stats, setStats] = useState(null)
  const [hot, setHot] = useState([])
  const [ctl, setCtl] = useState({ checks: 0, retimes: 0 })
  const [aiLog, setAiLog] = useState([])
  const [speed, setSpeed] = useState(1)
  // 3D by default. If the 3D map cannot start (no WebGL, tiles down) the
  // page falls back to the 2D canvas, which needs no network, and says why.
  // '3d' (default), 'pixel' (the same 3D map as SimCity-style pixel art) or
  // 'map' (the 2D canvas).
  const [display, setDisplay] = useState('3d')
  const [fail3d, setFail3d] = useState(null)
  const onFail3d = useCallback((why) => setFail3d(why), [])

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
    onCityParam?.(null)
  }, [stopRun, onCityParam])

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
    // Put the city in the address, so what is on screen can be shared.
    onCityParam?.(paramFor(city))
    document.title = `MainstreetAi · ${city.name} traffic`
    const withLlm = llmOn && !!llm.key.trim()
    setRunLlm(withLlm)
    // The visitor's own model wins if they brought one; otherwise the trained
    // network if it loaded and is selected; otherwise the rule-based one.
    const neural = !withLlm && useNeural && nn ? nn.model : null
    setRunNeural(!!neural)
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
        throw new Error(tr(`Only ${g.stats.signals} junctions with traffic lights were found ` +
          'around this point — too few for signal timing to matter. Try a denser city centre.',
          `Solo se encontraron ${g.stats.signals} cruces con semáforo cerca de este punto: ` +
          'muy pocos para que el horario de los semáforos importe. Prueba un centro más denso.'))
      }
      setGraph(g)
      setDetail(tr(`${g.stats.edges} streets · ${g.stats.signals} junctions with traffic lights`,
                   `${g.stats.edges} calles · ${g.stats.signals} cruces con semáforo`))

      // --- 2b. live traffic, if the site has a Mapbox or TomTom key ----------
      // Sizes the fleet to how congested these streets are right now. Optional:
      // no key or no answer means the street-length default, not a failed run.
      let lv = null
      if (LIVE_TRAFFIC) {
        setStage('live'); setDetail('')
        lv = await liveTraffic(g, g.signals, { signal: ac.signal, cacheKey: paramFor(city) })
      }
      setLive(lv)

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
      const base = Math.min(420, Math.max(90, Math.round(g.stats.km * 12)))
      const vehicles = lv ? vehiclesFor(base, lv.ratio) : base
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
              retimes += (neural ? neuralPolicy(t.ai, neural) : proportionalPolicy(t.ai)).applied
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
  }, [city, llm, llmOn, nn, useNeural, onCityParam]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- opening a city from the address ----------------------------------
  // A link like #/your-city/lima opens Lima and runs the analysis. The run is
  // held until the neural controller has finished loading (or failed to), so
  // a shared link is analysed with the same controller as a click would be.
  const autoRef = useRef(null)
  useEffect(() => {
    if (!cityParam) return
    if (city && paramFor(city) === cityParam) return
    const c = parsePlaceParam(cityParam) ?? SITE_CITIES.find((x) => citySlug(x) === cityParam)
    if (!c) return
    stopRun()
    setPhase('pick')
    setCity(c)
    autoRef.current = cityParam
  }, [cityParam]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!autoRef.current || !city || paramFor(city) !== autoRef.current) return
    if (nn === undefined) return
    autoRef.current = null
    launch()
  }, [city, nn, launch])

  const [copied, setCopied] = useState(false)
  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
    } catch {
      // Clipboard can be refused (permissions, http). The address bar already
      // holds the link, so say where it is instead of failing silently.
      window.prompt(tr('Copy this link:', 'Copia este enlace:'), window.location.href)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- loading
  if (phase === 'loading' || (phase === 'running' && error)) {
    return (
      <div className="try-page">
        <TrafficLoader
          stage={stage} steps={stepsFor(city, runLlm, tr)}
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
              {tr(`${s.edges} streets · ${s.signals} of ${s.junctions} junctions with traffic lights · ${world.fleet.length} vehicles`,
                  `${s.edges} calles · ${s.signals} de ${s.junctions} cruces con semáforo · ${world.fleet.length} vehículos`)} ·
              {' '}<span className="try-source">{source === 'ready-made' ? tr('ready-made streets', 'calles incluidas') : tr('streets downloaded live', 'calles descargadas en vivo')}</span>
            </p>
          </div>
          <div className="try-run-actions">
            <div className="try-switch" role="group" aria-label={tr('Which twin to show', 'Qué gemelo mostrar')}>
              {[['fixed', tr('Today: fixed timing', 'Hoy: horario fijo')],
                ['ai', runLlm ? tr('Your model', 'Tu modelo') : runNeural ? tr('Neural network', 'Red neuronal') : tr('Adaptive', 'Adaptativo')]].map(([k, label]) => (
                <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{label}</button>
              ))}
            </div>
            <div className="try-switch" role="group" aria-label={tr('View', 'Vista')}>
              {[['3d', '3D'], ['pixel', 'Pixel'], ['map', tr('Map', 'Mapa')]].map(([v, label]) => {
                const shown = fail3d ? 'map' : display
                return (
                  <button key={v} className={shown === v ? 'on' : ''}
                          onClick={() => { setDisplay(v); if (v !== 'map') setFail3d(null) }}>{label}</button>
                )
              })}
            </div>
            <div className="try-switch" role="group" aria-label={tr('Simulation speed', 'Velocidad de la simulación')}>
              {[1, 4, 10].map((n) => (
                <button key={n} className={speed === n ? 'on' : ''} onClick={() => setSpeed(n)}>{n}×</button>
              ))}
            </div>
            <button className="tl-btn" onClick={copyLink}>{copied ? tr('Link copied ✓', 'Enlace copiado ✓') : tr('Copy link', 'Copiar enlace')}</button>
            <button className="tl-btn" onClick={reset}>{tr('Another city', 'Otra ciudad')}</button>
          </div>
        </div>

        {live && (
          <p className="try-live">
            <span className="try-live-dot" aria-hidden="true" />
            <b>{tr('Live traffic now', 'Tráfico en vivo ahora')}</b>
            {(() => {
              const pc = (v) => Math.round(v * 100)
              const at = live.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              if (live.provider === 'mapbox') {
                const jam = pc(live.shares.moderate + live.shares.heavy + live.shares.severe)
                const bad = pc(live.shares.heavy + live.shares.severe)
                // Mapbox draws every road "low" where it has no probe data --
                // Santo Domingo at 07:05 on a Monday read 0% congested on 751
                // km of main road. A perfectly free city is said to be possibly
                // a missing feed, not reported as a fact.
                const allLow = live.shares.low >= 0.999
                return tr(`: of ${live.km.toFixed(0)} km of road here, ${jam}% is congested (${bad}% heavy or severe); estimated speed ~${pc(live.ratio)}% of free flow · read at ${at} your time.`,
                          `: de ${live.km.toFixed(0)} km de calles aquí, el ${jam}% está congestionado (${bad}% denso o severo); velocidad estimada ~${pc(live.ratio)}% de la normal · leído a las ${at} (tu hora).`) +
                  (allLow ? tr(' Mapbox marks every street as free-flowing, which in some cities means it has no live data there; treat this as no reading.',
                               ' Mapbox marca todas las calles como fluidas, lo que en algunas ciudades significa que no tiene datos en vivo; tómalo como sin lectura.') : '')
              }
              return tr(`: these streets are moving at ${Math.round(live.currentKmh)} km/h, ${pc(live.ratio)}% of their free-flow ${Math.round(live.freeKmh)} km/h (${live.points} points) · read at ${at} your time.`,
                        `: estas calles van a ${Math.round(live.currentKmh)} km/h, el ${pc(live.ratio)}% de sus ${Math.round(live.freeKmh)} km/h sin tráfico (${live.points} puntos) · leído a las ${at} (tu hora).`)
            })()}
            {' '}{tr('Both twins carry a fleet sized to that congestion, so the comparison below is for the traffic this city has right now. Sizing the fleet from congestion is a rule of thumb, not a calibration.',
                     'Los dos gemelos llevan una flota ajustada a esa congestión, así que la comparación de abajo es para el tráfico que la ciudad tiene ahora mismo. Ajustar la flota a la congestión es una regla aproximada, no una calibración.')}
            {' '}<span className="try-fine">{tr('Traffic data', 'Datos de tráfico')} © {live.provider === 'mapbox' ? 'Mapbox' : 'TomTom'}.</span>
          </p>
        )}

        {display !== 'map' && !fail3d
          ? <CityScene3D graph={graph} world={world} hotspots={hot} onFail={onFail3d}
                         pixel={display === 'pixel'} />
          : <CityCanvas graph={graph} world={world} palette={palette} running hotspots={hot} />}
        {fail3d && <p className="try-fine">{fail3d}</p>}

        <p className="try-clock">
          {tr('Simulated', 'Simulado')} {fmtTime(simTime)}
          {!settled && tr(' · measuring — the comparison settles after about a minute and a half',
                          ' · midiendo: la comparación se estabiliza en un minuto y medio')}
        </p>

        <div className="try-metrics">
          <Metric label={tr('Time spent stopped', 'Tiempo detenido')} unit=" min" settled={settled} d={stats.stopped}
                  a={stats.ai.stoppedVehSeconds / 60} b={stats.fixed.stoppedVehSeconds / 60} />
          <Metric label={tr('Average speed', 'Velocidad media')} unit=" km/h" settled={settled} d={stats.avgSpeed}
                  a={stats.ai.avgSpeedKmh} b={stats.fixed.avgSpeedKmh} digits={1} />
          <Metric label={tr('Junctions crossed', 'Cruces atravesados')} unit="" settled={settled} d={stats.arrivals}
                  a={stats.ai.arrivals} b={stats.fixed.arrivals} />
          <Metric label={tr('CO₂ per km driven', 'CO₂ por km recorrido')} unit=" g" settled={settled} d={stats.co2}
                  a={stats.ai.co2GramsPerKm} b={stats.fixed.co2GramsPerKm} />
        </div>
        {settled && stats.co2 && (() => {
          // Per km, not total: with fewer stops the AI twin's vehicles drive
          // more kilometres in the same time, which raises total CO2 even as
          // every kilometre gets cleaner. Savings are for the distance driven.
          const kmPerHour = stats.ai.distanceKm * 3600 / Math.max(stats.ai.simTime, 1)
          const savedKgH = (stats.fixed.co2GramsPerKm - stats.ai.co2GramsPerKm) / 1000 * kmPerHour
          return (
            <p className="try-co2">
              {savedKgH > 0
                ? <>≈ <b>{tr(`${savedKgH.toFixed(0)} kg of CO₂ avoided per hour`, `${savedKgH.toFixed(0)} kg de CO₂ evitados por hora`)}</b>
                    {' '}{tr('for the same distance driven in this ~2.5 km area, from fewer stops and less idling.',
                             'para la misma distancia recorrida en esta zona de ~2,5 km, gracias a menos paradas y menos tiempo al ralentí.')}</>
                : tr('No CO₂ saving per kilometre at this traffic level so far.', 'Por ahora no hay ahorro de CO₂ por kilómetro con este nivel de tráfico.')}
              {' '}{tr('Estimated with a power-based fuel model: the comparison is robust, the absolute figures are an order of magnitude.',
                       'Estimado con un modelo de consumo basado en potencia: la comparación es sólida; las cifras absolutas son un orden de magnitud.')}
            </p>
          )
        })()}

        <div className="try-analysis">
          <section className="try-hot">
            <h2>{tr('Where traffic queues worst today', 'Dónde se forman las peores colas hoy')}</h2>
            {hot.length ? (
              <ol>
                {hot.map((h) => (
                  <li key={h.id}>
                    {tr('Average queue', 'Cola media')} <b className="base">{h.fixed.toFixed(1)}</b>
                    {' '}<i aria-label={tr('becomes', 'pasa a')}>→</i>{' '}
                    <b className="ai">{h.adaptive.toFixed(1)}</b> {tr('vehicles', 'vehículos')}
                  </li>
                ))}
              </ol>
            ) : <p>{tr('Collecting queue data…', 'Recogiendo datos de colas…')}</p>}
            <p className="try-hot-note">
              {tr('Numbered on the map. Left: fixed timing, as the city runs now. Right: the same junction under ',
                  'Numerados en el mapa. Izquierda: horario fijo, como funciona hoy la ciudad. Derecha: el mismo cruce con ')}
              {runLlm ? tr('your model', 'tu modelo') : runNeural ? tr('the neural network', 'la red neuronal') : tr('adaptive control', 'control adaptativo')}.
            </p>
          </section>

          <section className="try-ctl">
            <h2>{tr('Controller', 'Controlador')}: {runLlm ? `${tr('your model', 'tu modelo')} (${PROVIDERS[llm.provider].label})`
              : runNeural ? tr('neural network', 'red neuronal') : tr('built-in adaptive', 'adaptativo integrado')}</h2>
            <p>
              {runLlm ? tr('Reads the queue on each arm of the busiest junctions and returns new green times.',
                           'Lee la cola de cada acceso de los cruces más cargados y devuelve nuevos tiempos de verde.')
                : runNeural ? <NeuralBlurb nn={nn} />
                : tr('Every few seconds it finds junctions with a real imbalance between their two directions and moves green time towards the longer queue, keeping each cycle the same length.',
                     'Cada pocos segundos busca cruces con un desequilibrio real entre sus dos direcciones y da más verde a la cola más larga, sin cambiar la duración del ciclo.')}
            </p>
            <p className="try-ctl-count">{ctl.retimes} {ctl.retimes === 1 ? tr('retiming', 'ajuste') : tr('retimings', 'ajustes')} · {ctl.checks} {ctl.checks === 1 ? tr('check', 'revisión') : tr('checks', 'revisiones')}</p>
            {quiet && (
              <p className="try-ctl-quiet">
                {tr('Little to fix here. Traffic at these junctions is light or evenly balanced, so the controller is mostly leaving timings alone — which is the right call, and why the numbers above barely move.',
                    'Poco que arreglar aquí. El tráfico en estos cruces es ligero o está equilibrado, así que el controlador casi no toca los tiempos: es lo correcto, y por eso los números de arriba apenas se mueven.')}
              </p>
            )}
            {runLlm && aiLog.length > 0 && <ul>{aiLog.map((l, i) => <li key={i}>{l}</li>)}</ul>}
          </section>
        </div>

        {s.estimatedSignals && (
          <p className="try-warn">
            {tr('OpenStreetMap has almost no traffic lights mapped here, so their positions are ', 'OpenStreetMap casi no tiene semáforos mapeados aquí, así que sus posiciones son ')}
            <b>{tr('estimated', 'estimadas')}</b>
            {tr(' (every junction of three or more streets). Treat this run as illustrative of the method rather than of this city’s actual signals.',
                ' (cada cruce de tres o más calles). Toma esta simulación como una ilustración del método, no de los semáforos reales de la ciudad.')}
          </p>
        )}

        <p className="try-note">
          <b>{tr('What is real.', 'Qué es real.')}</b>{' '}
          {tr('The streets, their lanes, speed limits and one-way rules, and where the traffic lights are, all come from OpenStreetMap (© OpenStreetMap contributors, ODbL). Both twins carry the same vehicles on the same streets from the same seed; the only difference is who times the lights.',
              'Las calles, sus carriles, límites de velocidad y sentidos, y dónde están los semáforos vienen de OpenStreetMap (© colaboradores de OpenStreetMap, ODbL). Los dos gemelos llevan los mismos vehículos por las mismas calles con la misma semilla; la única diferencia es quién programa los semáforos.')}
        </p>
        <p className="try-note">
          <b>{tr('What is simplified.', 'Qué está simplificado.')}</b>{' '}
          {tr('Vehicles follow random routes rather than measured trips, so this shows how adaptive timing behaves on this city’s network, not a forecast of its real traffic. The rule-based controller, measured on all 37 ready-made cities with three runs each, cut time stopped in 24 of them and made none measurably worse (mean −16%). The neural network was tested on 10 cities it never saw in training; its result is shown with the controller above. Average speed moves little either way: most of a trip is driving, not waiting at a light.',
              'Los vehículos siguen rutas aleatorias, no viajes medidos, así que esto muestra cómo se comportan los semáforos adaptativos en la red de esta ciudad, no un pronóstico de su tráfico real. El controlador por reglas, medido en las 37 ciudades incluidas con tres simulaciones cada una, redujo el tiempo detenido en 24 y no empeoró ninguna de forma medible (media −16%). La red neuronal se probó en 10 ciudades que nunca vio al entrenar; su resultado aparece arriba, con el controlador. La velocidad media cambia poco: la mayor parte de un viaje es conducir, no esperar en un semáforo.')}
        </p>
      </div>
    )
  }

  // ------------------------------------------------------------ the picker
  return (
    <div className="try-page">
      <header className="try-head">
        <h1>{tr('Your city', 'Tu ciudad')}</h1>
        <p>
          {tr('Pick any city. MainstreetAi loads its real streets and traffic lights, runs two identical traffic simulations, and lets an adaptive controller time the lights in one of them — so you can see where traffic queues and how much adaptive signal timing helps. No account and no key needed.',
              'Elige cualquier ciudad. MainstreetAi carga sus calles y semáforos reales, ejecuta dos simulaciones de tráfico idénticas y deja que un controlador adaptativo programe los semáforos en una de ellas, para que veas dónde se forman colas y cuánto ayudan los semáforos adaptativos. Sin cuenta y sin clave.')}
        </p>
      </header>

      <section className="try-step">
        <h2>{tr('Search for a place', 'Busca un lugar')}</h2>
        <form className="try-search" onSubmit={search}>
          <input
            type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={tr('City, district or address — e.g. Valencia, Medellín, Shibuya', 'Ciudad, barrio o dirección — p. ej. Valencia, Medellín, Shibuya')}
            aria-label={tr('Search for a place', 'Busca un lugar')} autoComplete="off" />
          <button className="tl-btn" type="submit" disabled={searching || query.trim().length < 2}>
            {searching ? tr('Searching…', 'Buscando…') : tr('Search', 'Buscar')}
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
          ) : <p className="try-search-error">{tr('No places found for', 'No se encontraron lugares para')} “{query}”.</p>
        )}
        <p className="try-fine">
          {tr('Search uses OpenStreetMap’s Nominatim; only the text you type is sent. The area analysed is about 2.5 km across, centred on the place you pick.',
              'La búsqueda usa Nominatim de OpenStreetMap; solo se envía el texto que escribes. La zona analizada mide unos 2,5 km, centrada en el lugar que elijas.')}
        </p>
      </section>

      <section className="try-step">
        <h2>{tr('Or open a ready-made city', 'O abre una ciudad incluida')} <em>{tr('instant, works offline', 'al instante, sin conexión')}</em></h2>
        {ready === null && <p className="try-fine">{tr('Loading the list…', 'Cargando la lista…')}</p>}
        {byRegion(readyCities).map(({ region, cities }) => (
          <div key={region} className="try-region">
            <h3>{tr(region, REGION_ES[region] ?? region)} <em>{cities.length}</em></h3>
            <div className="try-chips">
              {cities.map((c) => {
                const info = ready ? ready.get(citySlug(c)) : null
                return (
                  <button key={citySlug(c)} className={`try-chip ${city === c ? 'on' : ''}`}
                          onClick={() => setCity(c)}
                          title={info ? tr(`${info.signals} junctions with traffic lights`, `${info.signals} cruces con semáforo`) : undefined}>
                    <span className="flag">{c.flag}</span>{c.name}
                    {c.capital && <i className="try-cap" aria-label="capital" title="Capital">★</i>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </section>

      <section className="try-step">
        <h2>{tr('Controller', 'Controlador')}</h2>
        <div className="try-ctl-pick" role="radiogroup" aria-label={tr('Signal controller', 'Controlador de semáforos')}>
          <label className={useNeural && nn ? 'on' : ''}>
            <input type="radio" name="ctl" checked={!!(useNeural && nn)} disabled={!nn}
                   onChange={() => setUseNeural(true)} />
            <span>
              <b>{tr('Neural network', 'Red neuronal')}</b>
              <em>{nn === undefined ? tr('loading…', 'cargando…')
                : nn ? tr(`trained on ${nn.model.meta?.split?.train?.length ?? 'many'} cities · from ${nn.source}`,
                          `entrenada en ${nn.model.meta?.split?.train?.length ?? 'muchas'} ciudades · desde ${nn.source}`)
                : tr('could not be loaded — using rule-based', 'no se pudo cargar: se usa el de reglas')}</em>
            </span>
          </label>
          <label className={!(useNeural && nn) ? 'on' : ''}>
            <input type="radio" name="ctl" checked={!(useNeural && nn)}
                   onChange={() => setUseNeural(false)} />
            <span>
              <b>{tr('Rule-based', 'Por reglas')}</b>
              <em>{tr('proportional green splits', 'reparto proporcional del verde')}</em>
            </span>
          </label>
        </div>
      </section>

      <section className="try-step">
        <details className="try-byo" open={llmOn}>
          <summary onClick={(e) => { e.preventDefault(); setLlmOn((v) => !v) }}>
            {tr('Use your own AI model as the controller', 'Usa tu propio modelo de IA como controlador')} <em>{tr('optional', 'opcional')}</em>
          </summary>
          <p className="try-keynote">
            <b>{tr('Your key is not stored.', 'Tu clave no se guarda.')}</b>{' '}
            {tr('It lives only in this tab’s memory and goes straight from your browser to the provider you pick — this site is static and has no server of its own. Use a key with a spending limit: it is the one protection that does not depend on trusting us.',
                'Vive solo en la memoria de esta pestaña y va directo de tu navegador al proveedor que elijas: este sitio es estático y no tiene servidor propio. Usa una clave con límite de gasto: es la única protección que no depende de confiar en nosotros.')}
          </p>
          <KeyCard
            title={tr('Signal controller', 'Controlador de semáforos')}
            what={tr("Your model reads the queues at the busiest junctions and returns green times, in place of the built-in controller. It also picks the city's colours.",
                     'Tu modelo lee las colas de los cruces más cargados y devuelve los tiempos de verde, en lugar del controlador integrado. También elige los colores de la ciudad.')}
            cfg={llm} onChange={setLlm} />
        </details>
      </section>

      <div className="try-go glass">
        <div>
          <b>{city ? `${city.flag ?? '📍'} ${city.name}` : tr('No city selected yet', 'Aún no has elegido ciudad')}</b>
          <span>
            {!city ? tr('Search for a place or pick a ready-made city.', 'Busca un lugar o elige una ciudad incluida.')
              : city.live ? tr(`${city.label}. Its streets are downloaded live from OpenStreetMap, which can take up to a minute.`,
                               `${city.label}. Sus calles se descargan en vivo de OpenStreetMap, lo que puede tardar hasta un minuto.`)
              : tr('Ready-made: opens instantly.', 'Incluida: se abre al instante.')}
            {city && (llmOn && llm.key.trim() ? tr(' Controller: your model.', ' Controlador: tu modelo.')
              : useNeural && nn ? tr(' Controller: neural network.', ' Controlador: red neuronal.') : tr(' Controller: rule-based.', ' Controlador: por reglas.'))}
          </span>
        </div>
        <button className="tl-btn primary" disabled={!city} onClick={launch}>
          {tr('Analyse traffic', 'Analizar tráfico')}
        </button>
      </div>
    </div>
  )
}

/** What the neural controller is, with its own held-out result when the model carries one. */
function NeuralBlurb({ nn }) {
  const tr = useT()
  const meta = nn?.model?.meta
  const t = meta?.test?.summary
  const pct = (v) => `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}%`
  const n = meta?.split?.train?.length
  return (
    <>
      {tr(`A small neural network reads each junction’s queues and nudges its green split, keeping the cycle length. It was trained by evolution strategies on this same simulator across ${n ?? 'many'} cities, and loaded from ${nn?.source ?? 'the site'}.`,
          `Una pequeña red neuronal lee las colas de cada cruce y ajusta su reparto de verde, sin cambiar la duración del ciclo. Se entrenó con estrategias evolutivas en este mismo simulador con ${n ?? 'muchas'} ciudades, y se cargó desde ${nn?.source ?? 'el sitio'}.`)}
      {t && tr(` On ${t.cities} cities it never saw in training, time stopped changed by ${pct(t.nn_stopped_mean)}, against ${pct(t.rule_stopped_mean)} for the rule-based controller.`,
               ` En ${t.cities} ciudades que nunca vio al entrenar, el tiempo detenido cambió un ${pct(t.nn_stopped_mean)}, frente a ${pct(t.rule_stopped_mean)} del controlador por reglas.`)}
      {meta?.extra_tests?.latam && (() => {
        const l = meta.extra_tests.latam.summary
        return tr(` On ${l.cities} Latin American cities added after training: ${pct(l.nn_stopped_mean)} (rule-based ${pct(l.rule_stopped_mean)}), better in ${l.nn_beats_rule_cities} of ${l.cities}.`,
                  ` En ${l.cities} ciudades latinoamericanas añadidas después del entrenamiento: ${pct(l.nn_stopped_mean)} (por reglas ${pct(l.rule_stopped_mean)}), mejor en ${l.nn_beats_rule_cities} de ${l.cities}.`)
      })()}
    </>
  )
}

function fmtTime(s) {
  const m = Math.floor(s / 60)
  return `${m}m ${String(Math.floor(s % 60)).padStart(2, '0')}s`
}

function KeyCard({ title, what, cfg, onChange }) {
  const tr = useT()
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
        <select value={cfg.provider} aria-label={tr('Provider', 'Proveedor')}
                onChange={(e) => { onChange({ ...cfg, provider: e.target.value, model: '' }); setState(null) }}>
          {Object.entries(PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={cfg.model || p.models[0]} aria-label={tr('Model', 'Modelo')}
                onChange={(e) => onChange({ ...cfg, model: e.target.value })}>
          {p.models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <div className="try-key-row">
        {/* type=password so the key is not readable over a shoulder or in a
            screen share; autoComplete off so the browser never offers to keep
            it. */}
        <input type="password" autoComplete="off" spellCheck="false" aria-label={tr('API key', 'Clave de API')}
               placeholder={`${tr('API key', 'Clave de API')} (${p.hint})`}
               value={cfg.key}
               onChange={(e) => { onChange({ ...cfg, key: e.target.value }); setState(null) }} />
        <button className="tl-btn" disabled={!cfg.key.trim() || state === 'checking'} onClick={test}>
          {state === 'checking' ? tr('Testing…', 'Probando…') : tr('Test', 'Probar')}
        </button>
      </div>

      <p className="try-key-foot">
        {state === 'ok' && <span className="ok">✓ {tr('The key works', 'La clave funciona')}</span>}
        {state === 'bad' && <span className="bad">✗ {tr('This key could not be used', 'No se pudo usar esta clave')}</span>}
        {!state && <a href={p.keys} target="_blank" rel="noopener noreferrer">{tr(`Get a ${p.label} key ↗`, `Consigue una clave de ${p.label} ↗`)}</a>}
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
