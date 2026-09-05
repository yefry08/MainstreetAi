import { useCallback, useEffect, useRef, useState } from 'react'
import { CITIES, byCountry, bbox } from '../city/cities'
import { PROVIDERS, verifyKey } from '../city/ai'
import { fetchCity, buildGraph } from '../city/osm'
import { createTwins, compare } from '../city/sim'
import { cityPalette, startOrchestrator } from '../city/orchestrator'
import TrafficLoader from '../city/TrafficLoader'
import CityCanvas from '../city/CityCanvas'

/**
 * "Try your city": run the MainstreetAi comparison on any major city.
 *
 * FOUR STEPS, THEN THE SIMULATION
 * Country, city, providers, keys. Then the real work: OpenStreetMap supplies
 * the street network, one model supplies the palette, and two worlds run side
 * by side on identical traffic while a second model retimes the signals of one.
 *
 * WHAT IS REAL AND WHAT IS NOT -- the page says both, because the alternative
 * is letting a visitor believe the wrong one:
 *   - the streets are real OSM geometry, not generated
 *   - the traffic is a real simulation, simpler than the SUMO twins on Home
 *   - the AI genuinely reads queues and returns green times
 *   - the AI does NOT draw the map; it chooses the palette
 *
 * KEYS
 * Held in React state, nowhere else. Never localStorage, never a URL, never
 * sent anywhere but the provider the visitor chose -- this site is static and
 * has no backend of ours to send them to. Closing the tab destroys them.
 */

const STEPS = [
  { key: 'osm', label: 'Descargando calles reales de OpenStreetMap' },
  { key: 'graph', label: 'Construyendo el grafo de la ciudad' },
  { key: 'palette', label: 'La IA elige la paleta de la ciudad' },
  { key: 'sim', label: 'Arrancando los dos gemelos de tráfico' },
]

const DEFAULT_PALETTE = {
  ground: '#e9e3d6', roads: '#6e7078', buildings: '#c9c2b4',
  accent: '#d97757', sky: '#dceaf2', reason: '',
}

export default function TryCity() {
  const [step, setStep] = useState(1)
  const [country, setCountry] = useState(null)
  const [city, setCity] = useState(null)

  // Two providers, two keys. Kept apart so a visitor can use a cheap model for
  // the palette and a stronger one for the controller.
  const [mapCfg, setMapCfg] = useState({ provider: 'gemini', model: '', key: '' })
  const [aiCfg, setAiCfg] = useState({ provider: 'gemini', model: '', key: '' })

  const [phase, setPhase] = useState('form')     // form | loading | running
  const [stage, setStage] = useState('osm')
  const [detail, setDetail] = useState('')
  const [error, setError] = useState(null)

  const [graph, setGraph] = useState(null)
  const [palette, setPalette] = useState(DEFAULT_PALETTE)
  const [twins, setTwins] = useState(null)
  const [view, setView] = useState('ai')
  const [stats, setStats] = useState(null)
  const [aiLog, setAiLog] = useState([])

  const abortRef = useRef(null)
  const stopOrchRef = useRef(null)
  const rafRef = useRef(0)

  // Everything stops when the component goes away: the simulation loop, the
  // orchestrator's timer, and any in-flight request carrying a key.
  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current)
    stopOrchRef.current?.()
    abortRef.current?.abort()
  }, [])

  const countries = byCountry()

  const reset = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    stopOrchRef.current?.()
    abortRef.current?.abort()
    setPhase('form'); setStep(1); setError(null)
    setGraph(null); setTwins(null); setStats(null); setAiLog([])
    setPalette(DEFAULT_PALETTE)
  }, [])

  const launch = useCallback(async () => {
    setPhase('loading'); setError(null); setStage('osm'); setDetail('')
    const ac = new AbortController()
    abortRef.current = ac

    try {
      // --- 1. real streets ------------------------------------------------
      const osm = await fetchCity(bbox(city), {
        signal: ac.signal, onProgress: setDetail,
      })

      // --- 2. graph -------------------------------------------------------
      setStage('graph'); setDetail('')
      const g = buildGraph(osm, bbox(city))
      if (g.stats.signals < 3) {
        throw new Error(`Solo se encontraron ${g.stats.signals} cruces con semáforo ` +
                        'en este extracto. Prueba otra ciudad.')
      }
      setGraph(g)
      setDetail(`${g.stats.edges} calles · ${g.stats.signals} cruces con semáforo`)

      // --- 3. palette (the first key) --------------------------------------
      setStage('palette')
      try {
        setPalette(await cityPalette(mapCfg.provider, mapCfg.key, mapCfg.model, city, ac.signal))
      } catch (e) {
        if (e.name === 'AbortError') throw e
        // A palette is decoration. Losing it must not cost the simulation, so
        // it degrades to the default and says so rather than aborting.
        setAiLog((l) => [`Paleta: ${e.message} — se usa la paleta por defecto.`, ...l])
      }

      // --- 4. the twins ----------------------------------------------------
      setStage('sim')
      const density = Math.min(420, Math.max(90, Math.round(g.stats.km * 12)))
      const t = createTwins(g, { vehicles: density })
      setTwins(t)
      setPhase('running')

      // The simulation runs on rAF; the orchestrator on its own slow timer.
      let last = performance.now()
      const loop = () => {
        const now = performance.now()
        const dt = Math.min(0.4, (now - last) / 1000)
        last = now
        t.fixed.step(dt)
        t.ai.step(dt)
        setStats(compare(t))
        rafRef.current = requestAnimationFrame(loop)
      }
      rafRef.current = requestAnimationFrame(loop)

      stopOrchRef.current = startOrchestrator({
        world: t.ai,
        provider: aiCfg.provider, key: aiCfg.key, model: aiCfg.model,
        onTick: (r) => setAiLog((l) => [
          r.halted ? `Orquestador detenido: ${r.error}`
            : r.error ? `Error: ${r.error}`
            : `Retimados ${r.applied} de ${r.considered} cruces con más cola.`,
          ...l,
        ].slice(0, 6)),
      })
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message)
    }
  }, [city, mapCfg, aiCfg])

  // ---------------------------------------------------------------- render
  if (phase === 'loading' || (phase !== 'form' && error)) {
    return (
      <div className="try-page">
        <TrafficLoader
          stage={stage} steps={STEPS} detail={detail} error={error}
          onRetry={() => launch()} onCancel={reset}
        />
      </div>
    )
  }

  if (phase === 'running' && twins && graph) {
    const world = view === 'ai' ? twins.ai : twins.fixed
    return (
      <div className="try-run" style={{ '--city-accent': palette.accent }}>
        <div className="try-run-head">
          <div>
            <h1>{city.flag} {city.name}</h1>
            <p className="try-run-sub">
              {graph.stats.edges} calles · {graph.stats.signals} cruces ·
              {' '}{graph.stats.km.toFixed(1)} km-carril · {world.fleet.length} vehículos
            </p>
          </div>
          <div className="try-run-actions">
            <div className="try-switch">
              {['fixed', 'ai'].map((k) => (
                <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>
                  {k === 'ai' ? 'IA adaptativa' : 'Tiempo fijo'}
                </button>
              ))}
            </div>
            <button className="tl-btn" onClick={reset}>Otra ciudad</button>
          </div>
        </div>

        <CityCanvas graph={graph} world={world} palette={palette} running />

        {palette.reason && <p className="try-palette">🎨 {palette.reason}</p>}

        {stats && (
          <div className="try-metrics">
            <Metric label="Velocidad media" d={stats.speed}
                    a={stats.ai.meanSpeedKmh} b={stats.fixed.meanSpeedKmh} unit=" km/h" />
            <Metric label="Tiempo detenido" d={stats.stopped}
                    a={stats.ai.stoppedVehSeconds} b={stats.fixed.stoppedVehSeconds} unit=" s" />
            <Metric label="En cola ahora" d={stats.queued}
                    a={stats.ai.queued} b={stats.fixed.queued} unit="" />
            <Metric label="Cruces completados" d={stats.arrivals}
                    a={stats.ai.arrivals} b={stats.fixed.arrivals} unit="" />
          </div>
        )}

        <div className="try-ailog">
          <h2>Orquestador</h2>
          {aiLog.length ? <ul>{aiLog.map((l, i) => <li key={i}>{l}</li>)}</ul>
            : <p>Esperando la primera decisión…</p>}
        </div>

        <p className="try-note">
          Las calles son geometría real de OpenStreetMap (© colaboradores de OSM,
          ODbL). Los dos mundos parten de la misma semilla y llevan el mismo
          tráfico: lo único que cambia es quién controla los semáforos.
        </p>

        <p className="try-note">
          <b>Qué esperar de los números.</b> No esperes el +41% de Barcelona.
          Allí la demanda viene de un perfil calibrado con horas punta y
          corredores reales, así que hay direcciones cargadas y direcciones
          vacías — desequilibrio que un controlador puede aprovechar. Aquí las
          rutas son un paseo aleatorio, que reparte el tráfico casi por igual en
          cada cruce, y sin desequilibrio hay poco que repartir. Medido con una
          política de reparto proporcional: Santo Domingo bajó la cola un 16,9%,
          Barcelona un 6,7%, con la velocidad media casi plana en ambos. Ganancias
          pequeñas y que dependen de la ciudad. El mecanismo es el mismo que el de
          Home; lo que falta aquí es un modelo de demanda que le dé algo que
          optimizar.
        </p>
      </div>
    )
  }

  // ------------------------------------------------------------ the wizard
  const canLaunch = city && mapCfg.key.trim() && aiCfg.key.trim()

  return (
    <div className="try-page">
      <header className="try-head">
        <h1>Prueba tu ciudad</h1>
        <p>
          Ejecuta la comparación de MainstreetAi sobre cualquier ciudad grande:
          calles reales, dos simulaciones idénticas, y una IA que solo controla
          los semáforos de una de ellas.
        </p>
      </header>

      <Wizard step={step} />

      {step === 1 && (
        <section className="try-step">
          <h2>1 · Elige un país</h2>
          <div className="try-chips">
            {countries.map((c) => (
              <button key={c.country}
                      className={`try-chip ${country === c.country ? 'on' : ''}`}
                      onClick={() => { setCountry(c.country); setCity(null); setStep(2) }}>
                <span className="flag">{c.flag}</span>{c.country}
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="try-step">
          <h2>2 · Elige una ciudad</h2>
          <div className="try-chips">
            {CITIES.filter((c) => c.country === country).map((c) => (
              <button key={c.name}
                      className={`try-chip ${city?.name === c.name ? 'on' : ''}`}
                      onClick={() => { setCity(c); setStep(3) }}>
                {c.name}<em>{c.pop}M</em>
              </button>
            ))}
          </div>
          <button className="tl-btn" onClick={() => setStep(1)}>← Cambiar país</button>
        </section>
      )}

      {step >= 3 && (
        <section className="try-step">
          <h2>3 · Tus dos claves de API</h2>

          <p className="try-keynote">
            <b>Tus claves no se guardan.</b> Viven solo en la memoria de esta
            pestaña mientras está abierta: nunca se escriben en el navegador ni
            se envían a ningún servidor nuestro — este sitio es estático y no
            tiene backend. Van directamente de tu navegador al proveedor que
            elijas. Aun así, usa una clave con límite de gasto: es la única
            garantía que no depende de confiar en nosotros.
          </p>

          <KeyCard title="Clave 1 · Identidad visual"
                   what="Elige la paleta que representa a la ciudad. El mapa no lo genera la IA: sale de OpenStreetMap."
                   cfg={mapCfg} onChange={setMapCfg} />

          <KeyCard title="Clave 2 · Orquestador de tráfico"
                   what="Lee las colas de cada cruce y devuelve tiempos de verde. Es la solución MainstreetAi aplicada a tu ciudad."
                   cfg={aiCfg} onChange={setAiCfg} />

          <div className="try-launch">
            <button className="tl-btn primary" disabled={!canLaunch} onClick={launch}>
              {city ? `Simular ${city.name}` : 'Elige una ciudad'}
            </button>
            <button className="tl-btn" onClick={() => setStep(2)}>← Cambiar ciudad</button>
          </div>
        </section>
      )}
    </div>
  )
}

function Wizard({ step }) {
  const labels = ['País', 'Ciudad', 'Claves']
  return (
    <ol className="try-wizard">
      {labels.map((l, i) => (
        <li key={l} className={step > i + 1 ? 'done' : step === i + 1 ? 'active' : ''}>
          <i>{i + 1}</i>{l}
        </li>
      ))}
    </ol>
  )
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
        <select value={cfg.provider}
                onChange={(e) => { onChange({ ...cfg, provider: e.target.value, model: '' }); setState(null) }}>
          {Object.entries(PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>

        <select value={cfg.model || p.models[0]}
                onChange={(e) => onChange({ ...cfg, model: e.target.value })}>
          {p.models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <div className="try-key-row">
        {/* type=password so the key is not readable over a shoulder or in a
            screen share, and autoComplete off so the browser never offers to
            remember it. */}
        <input type="password" autoComplete="off" spellCheck="false"
               placeholder={`Clave (${p.hint})`}
               value={cfg.key}
               onChange={(e) => { onChange({ ...cfg, key: e.target.value }); setState(null) }} />
        <button className="tl-btn" disabled={!cfg.key.trim() || state === 'checking'} onClick={test}>
          {state === 'checking' ? 'Probando…' : 'Probar'}
        </button>
      </div>

      <p className="try-key-foot">
        {state === 'ok' && <span className="ok">✓ La clave funciona</span>}
        {state === 'bad' && <span className="bad">✗ No se pudo usar esta clave</span>}
        {!state && <a href={p.keys} target="_blank" rel="noopener noreferrer">Obtener una clave de {p.label} ↗</a>}
      </p>
    </div>
  )
}

function Metric({ label, d, a, b, unit }) {
  const fmt = (v) => (v == null ? '–' : v.toFixed(unit === ' km/h' ? 1 : 0))
  return (
    <div className="try-metric">
      <span className="try-metric-label">{label}</span>
      <span className="try-metric-pair">
        <b className="base">{fmt(b)}{unit}</b><i>→</i><b className="ai">{fmt(a)}{unit}</b>
      </span>
      <span className={`try-metric-delta ${d ? (d.good ? 'good' : 'bad') : ''}`}>
        {d ? `${d.value > 0 ? '+' : ''}${d.value.toFixed(1)}%` : '–'}
      </span>
    </div>
  )
}
