import { Suspense, lazy, useEffect, useState } from 'react'
import { assetUrl } from '../data/assetUrl'
import { loadSignalModel } from '../city/signalModel'
import { CITIES as CATALOGUE, citySlug, regionOf } from '../city/cities'
import { toHash } from '../data/route'
import { useT } from '../i18n'

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
 * They are only the FALLBACK now: when the neural controller loads, the card
 * shows that model's own held-out results, read from its file like the city
 * cards read their recordings.
 */
// Rule-based controller, 37 cities x 3 seeds, after the amber fix in sim.js.
const ANY_CITY = { cities: 37, improved: 24, meanStopped: -16 }

const CITIES = [
  {
    key: 'home', name: 'Barcelona', dir: 'replay',
    where: ['Eixample, Spain', 'Eixample, España'],
    blurb: ['Cerdà’s grid of chamfered blocks: 3,230 signalised approaches, with traffic demand shaped by the city’s own published traffic data.',
            'La cuadrícula de Cerdà con sus manzanas achaflanadas: 3.230 accesos con semáforo y una demanda de tráfico basada en los datos que publica la propia ciudad.'],
  },
  {
    key: 'manhattan', name: 'Manhattan', dir: 'replay_manhattan',
    where: ['Midtown, New York', 'Midtown, Nueva York'],
    blurb: ['A near-perfect grid with avenue-length green waves, the textbook case for signal coordination. 5,598 buildings at surveyed height.',
            'Una cuadrícula casi perfecta con olas verdes a lo largo de las avenidas, el caso de manual de coordinación semafórica. 5.598 edificios con su altura medida.'],
  },
]

// The biggest Latin American cities that are not capitals, shown beside the
// capitals so the strip is not only seats of government.
const FEATURED = ['sao-paulo', 'rio-de-janeiro', 'medellin', 'monterrey']

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
  const tr = useT()
  const r = useResult(city.dir)
  return (
    <article className="land-card glass">
      <p className="land-card-where">{tr(...city.where)}</p>
      <h3>{city.name}</h3>
      <p className="land-card-blurb">{tr(...city.blurb)}</p>
      {r?.error ? (
        <p className="land-card-missing">{tr('Result unavailable — open the city to see it live.',
                                             'Resultado no disponible: abre la ciudad para verlo en vivo.')}</p>
      ) : (
        <dl className="land-stats">
          <div><dt>{tr('Average speed', 'Velocidad media')}</dt><dd className="good">{r ? fmt(r.speed) : '…'}</dd></div>
          <div><dt>{tr('Time stopped', 'Tiempo detenido')}</dt><dd className="good">{r ? fmt(r.stopped) : '…'}</dd></div>
          <div><dt>{tr('Bus speed', 'Velocidad de buses')}</dt><dd className="good">{r ? fmt(r.bus) : '…'}</dd></div>
          <div><dt>CO₂</dt><dd className="good">{r ? fmt(r.co2) : '…'}</dd></div>
        </dl>
      )}
      <button className="land-btn" onClick={() => onTab(city.key)}>
        {tr(`Watch ${city.name} in 3D →`, `Ver ${city.name} en 3D →`)}
      </button>
    </article>
  )
}

/**
 * The any-city card. Shows the neural controller's own held-out results when
 * the model loads -- the controller visitors actually get -- and the
 * rule-based bench figures if it cannot be loaded.
 */
function AnyCityCard({ onTab }) {
  const tr = useT()
  const [nn, setNn] = useState(undefined)
  useEffect(() => {
    let alive = true
    loadSignalModel().then((r) => { if (alive) setNn(r) })
    return () => { alive = false }
  }, [])
  const t = nn?.model?.meta?.test?.summary
  return (
    <article className="land-card glass">
      <p className="land-card-where">{tr('Anywhere', 'Cualquier lugar')}</p>
      <h3>{tr('Your city', 'Tu ciudad')}</h3>
      <p className="land-card-blurb">
        {tr('Search any place. Its real streets and traffic lights load from OpenStreetMap, and a neural network trained on real cities times the lights in your browser. No account, no key.',
            'Busca cualquier lugar. Sus calles y semáforos reales se cargan de OpenStreetMap, y una red neuronal entrenada con ciudades reales programa los semáforos en tu navegador. Sin cuenta y sin clave.')}
      </p>
      {t ? (
        <dl className="land-stats">
          <div><dt>{tr('Time stopped', 'Tiempo detenido')}</dt><dd className="good">{fmt(t.nn_stopped_mean)}</dd></div>
          <div><dt>{tr('Longest waits (p95)', 'Esperas más largas (p95)')}</dt><dd className="good">{fmt(t.nn_p95wait_mean)}</dd></div>
          <div><dt>{tr('Unseen cities improved', 'Ciudades nuevas mejoradas')}</dt><dd className="good">{t.nn_beats_rule_cities} {tr('of', 'de')} {t.cities}</dd></div>
          <div><dt>{tr('Average speed', 'Velocidad media')}</dt><dd className="good">{fmt(t.nn_speed_mean)}</dd></div>
        </dl>
      ) : (
        <dl className="land-stats">
          <div><dt>{tr('Cities tested', 'Ciudades probadas')}</dt><dd>{ANY_CITY.cities}</dd></div>
          <div><dt>{tr('Less time stopped', 'Menos tiempo detenido')}</dt><dd className="good">{ANY_CITY.improved} {tr('of', 'de')} {ANY_CITY.cities}</dd></div>
          <div><dt>{tr('Mean change', 'Cambio medio')}</dt><dd className="good">{fmt(ANY_CITY.meanStopped)}</dd></div>
          <div><dt>{tr('Made worse', 'Empeoradas')}</dt><dd>0</dd></div>
        </dl>
      )}
      <p className="land-card-note">
        {t ? tr(`Neural controller on ${t.cities} cities it never saw in training, against fixed timing.`,
                `Controlador neuronal en ${t.cities} ciudades que nunca vio al entrenar, frente al horario fijo.`)
          : nn === undefined ? tr('Loading the neural controller’s results…', 'Cargando los resultados del controlador neuronal…')
          : tr('Rule-based controller, 37 cities.', 'Controlador por reglas, 37 ciudades.')}
      </p>
      <button className="land-btn" onClick={() => onTab('yours')}>{tr('Analyse a city →', 'Analizar una ciudad →')}</button>
    </article>
  )
}

/**
 * Every Latin American capital, plus the biggest other cities, one click from
 * an analysis.
 *
 * Plain links to #/your-city/<slug>, not buttons: they can be opened in a new
 * tab, copied, and shared, and the address-bar router does the rest. Only
 * cities the site has actually baked are listed (public/cities/index.json),
 * so none of them is a promise that falls back to a slow live download.
 */
function CapitalsStrip() {
  const tr = useT()
  const [ready, setReady] = useState(null)
  const [latam, setLatam] = useState(null)
  useEffect(() => {
    let alive = true
    loadSignalModel().then((r) => {
      if (alive) setLatam(r?.model?.meta?.extra_tests?.latam?.summary ?? null)
    })
    fetch(assetUrl('cities/index.json'))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive) setReady(new Set((j?.cities ?? []).map((c) => c.slug))) })
      .catch(() => { if (alive) setReady(new Set()) })
    return () => { alive = false }
  }, [])
  const capitals = CATALOGUE
    .filter((c) => c.capital && regionOf(c) === 'Latin America')
    .sort((a, b) => a.country.localeCompare(b.country, 'en'))
  const featured = FEATURED.map((s) => CATALOGUE.find((c) => citySlug(c) === s)).filter(Boolean)
  const isReady = (c) => ready?.has(citySlug(c))
  const shown = ready ? capitals.filter(isReady) : []
  const shownFeatured = ready ? featured.filter(isReady) : []
  if (ready && !shown.length && !shownFeatured.length) return null
  const link = (c) => (
    <li key={citySlug(c)}>
      <a href={toHash('yours', citySlug(c))}>
        <span className="flag" aria-hidden="true">{c.flag}</span>
        <b>{c.name}</b>
        <em>{c.country}</em>
      </a>
    </li>
  )
  return (
    <section className="land-section">
      <h2>{tr('Every capital in Latin America', 'Todas las capitales de América Latina')}</h2>
      <p className="land-sub">
        {tr('Real streets and traffic lights from OpenStreetMap, ready to analyse in your browser. Pick one: the analysis starts straight away.',
            'Calles y semáforos reales de OpenStreetMap, listos para analizar en tu navegador. Elige una: el análisis empieza al instante.')}
        {latam && tr(
          ` Across ${latam.cities} Latin American cities added after the neural controller was trained, it cut time stopped at lights by ${Math.abs(latam.nn_stopped_mean).toFixed(0)}%, and beat the rule-based controller in ${latam.nn_beats_rule_cities} of them.`,
          ` En ${latam.cities} ciudades latinoamericanas añadidas después de entrenar el controlador neuronal, redujo el tiempo detenido en semáforos un ${Math.abs(latam.nn_stopped_mean).toFixed(0)}% y superó al controlador por reglas en ${latam.nn_beats_rule_cities} de ellas.`)}
      </p>
      {shownFeatured.length > 0 && (
        <>
          <h3 className="land-strip-head">{tr('Big cities', 'Grandes ciudades')}</h3>
          <ul className="land-capitals featured">{shownFeatured.map(link)}</ul>
          <h3 className="land-strip-head">{tr('Capitals', 'Capitales')}</h3>
        </>
      )}
      <ul className="land-capitals">{shown.map(link)}</ul>
      {ready && shown.length < capitals.length && (
        <p className="land-card-note">
          {tr(`${shown.length} of ${capitals.length} ready; the rest can be searched for.`,
              `${shown.length} de ${capitals.length} listas; el resto se puede buscar.`)}
        </p>
      )}
      <p className="land-card-note">
        <a href={toHash('yours')}>{tr('All 89 cities, and search for any other →', 'Las 89 ciudades, y busca cualquier otra →')}</a>
      </p>
    </section>
  )
}

export default function Landing({ onTab }) {
  const tr = useT()
  return (
    <div className="land">
      <section className="land-hero">
        <div className="land-hero-text">
          <p className="land-eyebrow">{tr('Adaptive traffic signals · real cities · digital twins',
                                          'Semáforos adaptativos · ciudades reales · gemelos digitales')}</p>
          <h1>{tr('Same streets. Same traffic.', 'Mismas calles. Mismo tráfico.')}<br />
              {tr('Smarter traffic lights.', 'Semáforos más inteligentes.')}</h1>
          <p className="land-lede">
            {tr('MainstreetAi runs two identical simulations of a real city side by side. One keeps today’s fixed signal timings. In the other, AI reads the queues at every junction and retimes the lights. Everything else is held equal, so the difference you see is the signals and nothing else.',
                'MainstreetAi ejecuta lado a lado dos simulaciones idénticas de una ciudad real. Una mantiene los tiempos fijos de los semáforos de hoy. En la otra, la IA lee las colas en cada cruce y reprograma los semáforos. Todo lo demás es igual, así que la diferencia que ves son los semáforos y nada más.')}
          </p>
          <div className="land-cta">
            <button className="land-btn primary" onClick={() => onTab('home')}>{tr('Watch Barcelona', 'Ver Barcelona')}</button>
            <button className="land-btn" onClick={() => onTab('yours')}>{tr('Try your own city', 'Prueba tu ciudad')}</button>
            <button className="land-btn ghost" onClick={() => onTab('how')}>{tr('How it works', 'Cómo funciona')}</button>
          </div>
        </div>
        <figure className="land-hero-city">
          <Suspense fallback={<div className="land-city" />}><HeroCity /></Suspense>
          <figcaption>
            {tr('Live: a real simulation with adaptive signals.', 'En vivo: una simulación real con semáforos adaptativos.')}
            {' '}<span className="land-dot" /> {tr('stopped cars', 'coches detenidos')}
          </figcaption>
        </figure>
      </section>

      <section className="land-section">
        <h2>{tr('What the twins found', 'Lo que encontraron los gemelos')}</h2>
        <p className="land-sub">
          {tr('AI-timed signals against fixed timing, on the same simulated traffic. Figures come from the recorded runs shown in each city.',
              'Semáforos programados por IA frente a tiempos fijos, con el mismo tráfico simulado. Las cifras salen de las simulaciones grabadas que se muestran en cada ciudad.')}
        </p>
        <div className="land-grid">
          {CITIES.map((c) => <CityCard key={c.key} city={c} onTab={onTab} />)}
          <AnyCityCard onTab={onTab} />
        </div>
      </section>

      <CapitalsStrip />

      <section className="land-section">
        <h2>{tr('How it works', 'Cómo funciona')}</h2>
        <ol className="land-steps">
          <li>
            <span className="land-step-n">01</span>
            <h3>{tr('Real streets', 'Calles reales')}</h3>
            <p>{tr('Roads, lanes, speed limits and traffic-light positions come from OpenStreetMap, not from a model.',
                   'Calles, carriles, límites de velocidad y la posición de los semáforos vienen de OpenStreetMap, no de un modelo.')}</p>
          </li>
          <li>
            <span className="land-step-n">02</span>
            <h3>{tr('Two identical twins', 'Dos gemelos idénticos')}</h3>
            <p>{tr('The same vehicles enter the same network from the same seed. Only the signal controller differs.',
                   'Los mismos vehículos entran en la misma red con la misma semilla. Solo cambia el controlador de semáforos.')}</p>
          </li>
          <li>
            <span className="land-step-n">03</span>
            <h3>{tr('AI times the lights', 'La IA programa los semáforos')}</h3>
            <p>{tr('It moves green time towards the longer queues while keeping each cycle the same length, and the result is measured, not asserted.',
                   'Da más tiempo de verde a las colas más largas sin cambiar la duración de cada ciclo, y el resultado se mide, no se supone.')}</p>
          </li>
        </ol>
        <button className="land-btn ghost" onClick={() => onTab('how')}>{tr('See it step by step →', 'Verlo paso a paso →')}</button>
      </section>

      <footer className="land-foot">
        <p>
          <b>{tr('A simulation, said plainly.', 'Una simulación, dicho claramente.')}</b>{' '}
          {tr('Barcelona and Manhattan run in SUMO, the open-source traffic simulator used in research. Your city runs a simpler model in the browser. Results show how adaptive timing behaves on each network; they are not a forecast of real-world traffic.',
              'Barcelona y Manhattan corren en SUMO, el simulador de tráfico de código abierto que se usa en investigación. Tu ciudad corre un modelo más simple en el navegador. Los resultados muestran cómo se comportan los semáforos adaptativos en cada red; no son un pronóstico del tráfico real.')}
        </p>
        <p className="land-links">
          <button onClick={() => onTab('research')}>{tr('Research', 'Investigación')}</button>
          <span aria-hidden="true">·</span>
          <button onClick={() => onTab('contact')}>{tr('Contact', 'Contacto')}</button>
        </p>
        <p className="land-credits">{tr('Street data © OpenStreetMap contributors (ODbL). Flag emoji: Twemoji, CC-BY 4.0. Live traffic © Mapbox.',
                                        'Datos de calles © colaboradores de OpenStreetMap (ODbL). Banderas: Twemoji, CC-BY 4.0. Tráfico en vivo © Mapbox.')}</p>
      </footer>
    </div>
  )
}
