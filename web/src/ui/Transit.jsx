import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { assetUrl } from '../data/assetUrl'
import { toHash } from '../data/route'
import { osmUrl } from '../transit/coverage'
import { EXAMPLES, SYSTEM, buildEvidence, checkCitations, userPrompt } from '../transit/assistant'
import { PROVIDERS, complete } from '../city/ai'
import { CROSS_MIN, modeShift, modeShiftAll, noEffect, readCurve, simultaneous } from '../transit/scenario'
import { useT } from '../i18n'
import { SITE } from '../site'

/**
 * Transit: where people live far from a bus stop, as route-review flags.
 *
 * Built for the GenAI for Good Challenge's Pristina use case (UNDP / IEEE):
 * "highlight locations where current evidence suggests a route may no longer
 * match demand, without recommending or making changes itself", with every
 * finding linked to its source. The data is public-only -- OpenStreetMap's
 * homes, stops and Trafiku Urban routes, baked by scripts/bake-transit.mjs --
 * so it runs before any municipal data is shared, and says what that limits.
 *
 * Nothing here recommends a route. A flag is "many homes, no stop within
 * walking distance on the map", with the elements behind it; the planner
 * judges it.
 */
const STYLE = 'https://tiles.openfreemap.org/styles/dark'
const SHOWN = 12

export default function Transit({ city = 'pristina' }) {
  const tr = useT()
  const [data, setData] = useState(undefined)
  const [pick, setPick] = useState(null)
  const ref = useRef(null)
  const mapRef = useRef(null)

  // Which cities have transit data (scripts/bake-transit.mjs writes the index).
  const [cities, setCities] = useState([])
  useEffect(() => {
    fetch(assetUrl('transit/index.json')).then((r) => (r.ok ? r.json() : null))
      .then((j) => setCities(j?.cities ?? [])).catch(() => setCities([]))
  }, [])

  useEffect(() => {
    let alive = true
    document.title = `MainstreetAi · ${tr('Transit', 'Transporte')}`
    setData(undefined)
    fetch(assetUrl(`transit/${encodeURIComponent(city)}.json`))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive) setData(j) })
      .catch(() => { if (alive) setData(null) })
    return () => { alive = false }
  }, [city])

  useEffect(() => {
    if (!data || !ref.current) return
    const map = new maplibregl.Map({
      container: ref.current, style: STYLE, center: [data.centre[1], data.centre[0]], zoom: 12.3,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    map.on('load', () => {
      const fc = (features) => ({ type: 'FeatureCollection', features })
      map.addSource('routes', { type: 'geojson', data: fc(data.routes.flatMap((r) => r.lines.map((l) => ({
        type: 'Feature', properties: { ref: r.ref },
        geometry: { type: 'LineString', coordinates: l.map(([la, lo]) => [lo, la]) },
      })))) })
      map.addSource('stops', { type: 'geojson', data: fc(data.stops.map((s) => ({
        type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      }))) })
      map.addSource('gaps', { type: 'geojson', data: fc(data.gaps.map((g, i) => ({
        type: 'Feature', properties: { i, homes: g.homes }, geometry: { type: 'Point', coordinates: [g.lon, g.lat] },
      }))) })
      map.addLayer({ id: 'routes', type: 'line', source: 'routes',
        paint: { 'line-color': '#4aa3df', 'line-width': 2, 'line-opacity': 0.75 } })
      // The walking catchment: a 400 m disc at every stop, drawn in metres.
      // MapLibre's tiles are 512 px, so a pixel at zoom z is 78,271.5 * cos(lat)
      // / 2^z metres (half the 256-px figure, which drew the disc half size).
      const mPerPx = (z) => (78271.517 * Math.cos((data.centre[0] * Math.PI) / 180)) / 2 ** z
      map.addLayer({ id: 'catch', type: 'circle', source: 'stops', paint: {
        'circle-color': '#4aa3df', 'circle-opacity': 0.07,
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'],
          10, data.totals.walkM / mPerPx(10), 18, data.totals.walkM / mPerPx(18)],
      } })
      map.addLayer({ id: 'stops', type: 'circle', source: 'stops',
        paint: { 'circle-color': '#9fd3f5', 'circle-radius': 2.5 } })
      map.addLayer({ id: 'gaps', type: 'circle', source: 'gaps', paint: {
        'circle-color': '#e5484d', 'circle-opacity': 0.8, 'circle-stroke-color': '#1a0b0b', 'circle-stroke-width': 1,
        'circle-radius': ['interpolate', ['linear'], ['get', 'homes'], 15, 4, 150, 14],
      } })
      map.on('click', 'gaps', (e) => setPick(e.features[0].properties.i))
      map.on('mouseenter', 'gaps', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'gaps', () => { map.getCanvas().style.cursor = '' })
    })
    return () => { map.remove(); mapRef.current = null }
  }, [data])

  useEffect(() => {
    const g = pick != null && data?.gaps[pick]
    if (g && mapRef.current) mapRef.current.flyTo({ center: [g.lon, g.lat], zoom: 15, duration: 900 })
  }, [pick, data])

  if (data === undefined) return <div className="transit-page"><p className="try-fine">{tr('Loading…', 'Cargando…')}</p></div>
  if (!data) {
    return (
      <div className="transit-page">
        <h1>{tr('Transit', 'Transporte')}</h1>
        <p>{tr(`No transit data for “${city}” yet.`, `Todavía no hay datos de transporte para “${city}”.`)}{' '}
          <a href={toHash('transit', SITE.defaultCity.transit)}>{tr('Open the default city →', 'Abrir la ciudad por defecto →', 'Hap qytetin kryesor →')}</a></p>
      </div>
    )
  }

  const t = data.totals
  const pct = (v) => `${Math.round(v * 100)}%`
  const lines = new Set(data.routes.map((r) => r.ref).filter(Boolean))
  return (
    <div className="transit-page">
      <header className="try-head">
        <p className="land-eyebrow">{tr('Route review · open data', 'Revisión de rutas · datos abiertos')}</p>
        <h1>{data.city}: {tr('who lives far from a bus stop', 'quién vive lejos de una parada de bus')}</h1>
        {cities.length > 1 && (
          <select className="green-pick" value={data.slug} aria-label={tr('City', 'Ciudad')}
                  onChange={(e) => { window.location.hash = toHash('transit', e.target.value) }}>
            {cities.map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}
          </select>
        )}
        <p>
          {tr(`Every home in OpenStreetMap, checked against every bus stop: ${pct(t.coveredShare)} of ${t.homes.toLocaleString()} homes are within ${t.walkM} m of a stop. The red circles are ${data.gaps.length} places where ${t.minHomes} or more homes have none — ${t.flaggedHomes.toLocaleString()} homes in all. Each is a prompt for review, linked to the map data behind it; none is a recommendation.`,
              `Cada vivienda de OpenStreetMap, comparada con cada parada de bus: el ${pct(t.coveredShare)} de ${t.homes.toLocaleString('es')} viviendas está a menos de ${t.walkM} m de una parada. Los círculos rojos son ${data.gaps.length} lugares donde ${t.minHomes} o más viviendas no tienen ninguna — ${t.flaggedHomes.toLocaleString('es')} viviendas en total. Cada uno es un aviso para revisar, enlazado a los datos del mapa que lo sostienen; ninguno es una recomendación.`)}
        </p>
      </header>

      <dl className="land-stats transit-stats">
        <div><dt>{tr('Bus stops', 'Paradas')}</dt><dd>{t.stops}</dd></div>
        <div><dt>{tr('Lines mapped', 'Líneas mapeadas')}</dt><dd>{lines.size}</dd></div>
        <div><dt>{tr(`Homes within ${t.walkM} m`, `Viviendas a < ${t.walkM} m`)}</dt><dd>{pct(t.coveredShare)}</dd></div>
        <div><dt>{tr('Homes in flagged areas', 'Viviendas en zonas marcadas')}</dt><dd className="bad">{t.flaggedHomes.toLocaleString()}</dd></div>
      </dl>

      <div className="transit-grid">
        <div className="transit-map" ref={ref} role="img"
             aria-label={tr('Map of bus routes, stops with their 400 m catchment, and flagged areas.',
                            'Mapa de rutas de bus, paradas con su radio de 400 m y zonas marcadas.')} />
        <section className="transit-list">
          <h2>{tr('Review list', 'Lista de revisión')}</h2>
          <ol>
            {data.gaps.slice(0, SHOWN).map((g, i) => (
              <li key={i} className={pick === i ? 'on' : ''}>
                <button onClick={() => setPick(i)}>
                  <b>{g.homes} {tr('homes', 'viviendas')}{g.area?.name ? ` · ${g.area.name}` : ''}</b>
                  <span>{g.nearestM != null
                    ? tr(`nearest stop ${g.nearestM} m`, `parada más cercana a ${g.nearestM} m`)
                    : tr('no stop found nearby', 'sin parada cercana')}
                    {g.nearestStop?.name ? ` · ${g.nearestStop.name}` : ''}</span>
                </button>
                {pick === i && (
                  <p className="transit-evidence">
                    {tr('Evidence', 'Evidencia')}:{' '}
                    {g.homeIds.map((id, k) => (
                      <a key={id} href={osmUrl(id)} target="_blank" rel="noopener noreferrer">
                        {tr('home', 'vivienda')} {k + 1}
                      </a>
                    ))}
                    {g.nearestStop && (
                      <a href={osmUrl(g.nearestStop.id)} target="_blank" rel="noopener noreferrer">
                        {tr('nearest stop', 'parada más cercana')}
                      </a>
                    )}
                    <a href={`https://www.openstreetmap.org/#map=17/${g.lat}/${g.lon}`} target="_blank" rel="noopener noreferrer">
                      {tr('area on OSM', 'zona en OSM')}
                    </a>
                  </p>
                )}
              </li>
            ))}
          </ol>
          <p className="try-fine">
            {tr(`Showing the ${SHOWN} largest of ${data.gaps.length}. Click one on the map or here.`,
                `Se muestran las ${SHOWN} mayores de ${data.gaps.length}. Haz clic en una del mapa o de aquí.`)}
          </p>
        </section>
      </div>

      {pick != null && data.gaps[pick] && <Scenario key={pick} data={data} gap={data.gaps[pick]} />}

      <Ask data={data} onPick={setPick} />

      <p className="try-note">
        <b>{tr('What this is not.', 'Qué no es esto.')}</b>{' '}
        {tr('Proof of unmet demand. OpenStreetMap can miss stops (a gap in the map, not in the service), homes stand in for riders, and the distance is straight-line rather than walking. With the city’s own GPS, schedule and complaint data, the same flags would rest on ridership instead.',
            'Una prueba de demanda insatisfecha. OpenStreetMap puede no tener alguna parada (un hueco en el mapa, no en el servicio), las viviendas son una aproximación a los usuarios, y la distancia es en línea recta, no a pie. Con los datos propios de la ciudad (GPS, horarios y quejas), los mismos avisos se basarían en el uso real.')}
      </p>
      <p className="try-note">
        <b>{tr('Traffic in the centre.', 'El tráfico del centro.')}</b>{' '}
        <a href={toHash('yours', data.slug)}>
          {tr(`Open ${data.city}’s traffic twin: real streets, live traffic, and what adaptive signals change →`,
              `Abre el gemelo de tráfico de ${data.city}: calles reales, tráfico en vivo y lo que cambian los semáforos adaptativos →`)}
        </a>
      </p>
      <p className="land-credits">
        {tr('Homes, stops and bus routes © OpenStreetMap contributors (ODbL), read',
            'Viviendas, paradas y rutas de bus © colaboradores de OpenStreetMap (ODbL), leídos el')}{' '}
        {new Date(data.generated).toLocaleDateString()}.
      </p>
    </div>
  )
}

/**
 * "If this area got a bus". The arithmetic (cars, km, CO2) follows the
 * sliders; the centre's response is read from a curve baked once over three
 * seeds (scripts/bake-transit-sim.mjs), so it is instant and shown as a range
 * -- and called "no measurable change" when that range spans zero. See
 * transit/scenario.js for why the two halves are kept apart.
 */
function Scenario({ data, gap }) {
  const tr = useT()
  const [drive, setDrive] = useState(0.4)
  const [sw, setSw] = useState(0.25)
  const [all, setAll] = useState(false)       // this area, or every flagged area together
  const s = all
    ? modeShiftAll({ gaps: data.gaps, centre: data.centre, driveShare: drive, switchShare: sw })
    : modeShift({ gap, centre: data.centre, driveShare: drive, switchShare: sw })
  const sim = data.sim
  const atOnce = simultaneous(s.cars)
  const share = sim ? atOnce / sim.vehicles : 0
  const c = sim && readCurve(sim, share)

  const f = (v) => (v > 0.5 ? '+' : v < -0.5 ? '−' : '±') + Math.abs(v).toFixed(0) + '%'
  const range = ([lo, hi]) => (Math.round(lo) === Math.round(hi) ? f(lo) : `${f(lo)} … ${f(hi)}`)
  const verdict = (r, good) => (noEffect(r)
    ? <em className="scn-none">{tr('no measurable change', 'sin cambio medible')}</em>
    : <em className={(r[1] < 0) === good ? 'scn-good' : 'scn-bad'}>{range(r)}</em>)
  const slider = (label, v, set) => (
    <label className="scn-slider">
      <span>{label}: <b>{Math.round(v * 100)}%</b></span>
      <input type="range" min="0" max="1" step="0.05" value={v} onChange={(e) => set(+e.target.value)} />
    </label>
  )
  return (
    <section className="scn glass">
      <h2>{all ? tr(`If all ${data.gaps.length} flagged areas got a bus`, `Si las ${data.gaps.length} zonas marcadas tuvieran bus`)
               : tr(`If ${gap.area?.name ?? 'this area'} got a bus`, `Si ${gap.area?.name ?? 'esta zona'} tuviera bus`)}</h2>
      <div className="try-switch" role="group" aria-label={tr('Scope', 'Alcance')}>
        <button className={!all ? 'on' : ''} onClick={() => setAll(false)}>
          {gap.area?.name ?? tr('This area', 'Esta zona')} · {gap.homes}
        </button>
        <button className={all ? 'on' : ''} onClick={() => setAll(true)}>
          {tr(`All ${data.gaps.length} areas`, `Las ${data.gaps.length} zonas`)} · {data.totals.flaggedHomes.toLocaleString()}
        </button>
      </div>
      <p className="try-fine">
        {tr(`${all ? data.totals.flaggedHomes : gap.homes} homes. The two shares below are assumptions, not data about ${data.city} — replace them with the municipality’s travel survey or GPS data.`,
            `${all ? data.totals.flaggedHomes : gap.homes} viviendas. Los dos porcentajes de abajo son supuestos, no datos de ${data.city}: sustitúyelos por la encuesta de movilidad o los datos GPS de la municipalidad.`)}
      </p>
      <div className="scn-sliders">
        {slider(tr('Homes that drive to the centre at peak', 'Viviendas que van en coche al centro en hora pico'), drive, setDrive)}
        {slider(tr('Of those, would switch to a new bus', 'De ellas, cambiarían a un bus nuevo'), sw, setSw)}
      </div>
      <dl className="land-stats">
        <div><dt>{tr('Cars off the road at peak', 'Coches menos en hora pico')}</dt><dd className="good">{s.cars}</dd></div>
        <div><dt>{all ? tr('Average trip to the centre', 'Viaje medio al centro') : tr('Trip to the centre', 'Viaje al centro')}</dt><dd>{s.tripKm.toFixed(1)} km</dd></div>
        <div><dt>{tr('Car-km avoided per weekday', 'Km en coche evitados por día laborable')}</dt><dd className="good">{Math.round(s.kmPerDay).toLocaleString()}</dd></div>
        <div><dt>{tr('CO₂ avoided per weekday', 'CO₂ evitado por día laborable')}</dt><dd className="good">{s.co2KgPerDay.toFixed(0)} kg</dd></div>
      </dl>
      <p className="try-fine">
        {tr(`≈ ${(s.co2KgPerDay * 250 / 1000).toFixed(1)} t of CO₂ a year over 250 weekdays (the morning trip and the return). Distance is straight line × 1.3; CO₂ per km from the site’s fuel model at 30 km/h.`,
            `≈ ${(s.co2KgPerDay * 250 / 1000).toFixed(1)} t de CO₂ al año en 250 días laborables (ida y vuelta). Distancia en línea recta × 1,3; CO₂ por km del modelo de consumo del sitio a 30 km/h.`)}
      </p>

      {c && (
        <>
          <h3 className="land-strip-head">{tr('And in the centre’s traffic', 'Y en el tráfico del centro')}</h3>
          <table className="scn-table">
            <thead><tr><th /><th>{tr('Stopped time per car', 'Tiempo detenido por coche')}</th></tr></thead>
            <tbody>
              <tr><th>{Math.round(atOnce) === 1
                    ? tr('1 fewer car in the centre, fixed timing', '1 coche menos en el centro, horario fijo')
                    : tr(`${Math.round(atOnce)} fewer cars in the centre, fixed timing`, `${Math.round(atOnce)} coches menos en el centro, horario fijo`)}</th>
                  {/* Fewer cars making each remaining one wait longer is seed noise
                      (measured: +3..+27% at 13%, -9..+26% at 30%), not an effect. */}
                  <td>{c.mode[0] > 0 ? <em className="scn-none">{tr('no measurable change', 'sin cambio medible')}</em> : verdict(c.mode, true)}</td></tr>
              <tr><th>{tr('AI signals, same traffic', 'Semáforos IA, mismo tráfico')}</th><td>{verdict(c.ai, true)}</td></tr>
              <tr className="scn-both"><th>{tr('Both, against today', 'Ambos, frente a hoy')}</th><td>{verdict(c.both, true)}</td></tr>
            </tbody>
          </table>
          <p className="try-note">
            {(noEffect(c.mode) || c.mode[0] > 0) && !noEffect(c.ai)
              ? tr('The two levers do different things. At this traffic level the waiting in this city’s centre comes from red lights, not crowding, so fewer cars barely changes it while retiming the lights does. The bus’s gain is the car-km and CO₂ above, and its residents’ access; the signals’ gain is the waiting.',
                   'Las dos palancas hacen cosas distintas. A este nivel de tráfico, la espera en el centro de esta ciudad viene de los semáforos en rojo, no de la saturación, así que menos coches apenas la cambia y reprogramar los semáforos sí. La ganancia del bus son los km en coche y el CO₂ de arriba, y el acceso de sus vecinos; la de los semáforos, la espera.')
              : tr('Ranges are the spread over three simulation seeds.', 'Los rangos son la dispersión entre tres semillas de simulación.')}
          </p>
          <p className="try-fine">
            {tr(`${data.city}’s real centre (2.5 km, ${sim.vehicles} vehicles), 5 simulated minutes per run, three seeds, neural controller; baked ${sim.generated.slice(0, 10)}. ${s.cars} cars an hour that each spend ~${CROSS_MIN} min crossing the centre are ${atOnce.toFixed(1)} fewer in it at any moment (Little’s law) — ${(share * 100).toFixed(1)}% of the fleet. Per remaining car, so fewer cars does not count as less waiting by itself. A range that spans zero is reported as no measurable change.`,
                `Centro real de ${data.city} (2,5 km, ${sim.vehicles} vehículos), 5 minutos simulados por corrida, tres semillas, controlador neuronal; calculado el ${sim.generated.slice(0, 10)}. ${s.cars} coches por hora que pasan ~${CROSS_MIN} min cruzando el centro son ${atOnce.toFixed(1)} menos dentro en cada momento (ley de Little): el ${(share * 100).toFixed(1)}% de la flota. Por coche que queda, para que tener menos coches no cuente por sí solo como menos espera. Un rango que cruza el cero se indica como sin cambio medible.`)}
          </p>
        </>
      )}
    </section>
  )
}

/**
 * Ask the evidence. The visitor's own model answers from the numbered records
 * only (transit/assistant.js); every [id] it cites is checked and rendered as
 * a link to its source, and an id that does not exist is shown as an error.
 */
function Ask({ data, onPick }) {
  const tr = useT()
  const askNames = (i) => {
    const n = SITE.askLangs.map((l) => EXAMPLES[l].name[i])
    const and = [' or ', ' o ', ' ose '][i]
    return n.length > 1 ? `${n.slice(0, -1).join(', ')}${and}${n.at(-1)}` : n[0]
  }
  const [cfg, setCfg] = useState({ provider: 'gemini', model: '', key: '' })
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState(null)       // {question, parts, cited, unknown} | {error}
  const abortRef = useRef(null)
  useEffect(() => () => abortRef.current?.abort(), [])
  const records = buildEvidence(data)
  const p = PROVIDERS[cfg.provider]

  const ask = async (question) => {
    if (!question.trim() || !cfg.key.trim()) return
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setBusy(true); setOut(null)
    try {
      const reply = await complete(cfg.provider, cfg.key.trim(), {
        model: cfg.model || p.models[0], system: SYSTEM, user: userPrompt(question, records),
        maxTokens: 500, signal: ac.signal,
      })
      setOut({ question, ...checkCitations(reply, records) })
    } catch (err) {
      if (err.name !== 'AbortError') setOut({ error: err.message })
    } finally {
      setBusy(false)
    }
  }

  const cite = (id, ok, k) => {
    if (!ok) return <span key={k} className="ask-cite bad" title={tr('Not in the evidence', 'No está en la evidencia')}>[{id}?]</span>
    const r = records.get(id)
    if (r.kind === 'gap') {
      return <button key={k} className="ask-cite" onClick={() => onPick(r.index)} title={r.text}>{id}</button>
    }
    if (r.osm) {
      return <a key={k} className="ask-cite" href={r.osm} target="_blank" rel="noopener noreferrer" title={r.text}>{id}</a>
    }
    return <span key={k} className="ask-cite" title={r.text}>{id}</span>
  }

  return (
    <section className="ask glass">
      <h2>{tr('Ask the evidence', 'Pregunta a la evidencia')}</h2>
      <p className="try-fine">
        {tr(`Questions in ${askNames(0)}. The answer comes only from the ${records.size} numbered records on this page, and every claim is cited: click a citation to see it on the map or at its source. Nothing is recommended.`,
            `Preguntas en ${askNames(1)}. La respuesta sale solo de los ${records.size} registros numerados de esta página, y cada afirmación va citada: pulsa una cita para verla en el mapa o en su fuente. No se recomienda nada.`)}
      </p>

      <div className="try-key-row">
        <select value={cfg.provider} aria-label={tr('Provider', 'Proveedor')}
                onChange={(e) => setCfg({ ...cfg, provider: e.target.value, model: '' })}>
          {Object.entries(PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={cfg.model || p.models[0]} aria-label={tr('Model', 'Modelo')}
                onChange={(e) => setCfg({ ...cfg, model: e.target.value })}>
          {p.models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        {/* Same handling as Your city: memory only, never stored or logged. */}
        <input type="password" autoComplete="off" spellCheck="false" aria-label={tr('API key', 'Clave de API')}
               placeholder={`${tr('API key', 'Clave de API')} (${p.hint})`} value={cfg.key}
               onChange={(e) => setCfg({ ...cfg, key: e.target.value })} />
      </div>
      <p className="try-fine">
        {tr('Your key stays in this tab’s memory and goes only to the provider you pick.',
            'Tu clave se queda en la memoria de esta pestaña y solo va al proveedor que elijas.')}{' '}
        <a href={p.keys} target="_blank" rel="noopener noreferrer">{tr(`Get a ${p.label} key ↗`, `Consigue una clave de ${p.label} ↗`)}</a>
      </p>

      <form className="try-search" onSubmit={(e) => { e.preventDefault(); ask(q) }}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
               aria-label={tr('Your question', 'Tu pregunta')}
               placeholder={tr('e.g. Which neighbourhoods have homes far from any stop?', 'p. ej. ¿Qué barrios tienen viviendas lejos de toda parada?')} />
        <button className="tl-btn primary" type="submit" disabled={busy || !q.trim() || !cfg.key.trim()}>
          {busy ? tr('Asking…', 'Preguntando…') : tr('Ask', 'Preguntar')}
        </button>
      </form>
      <div className="ask-examples">
        {SITE.askLangs.map((lang) => ({ lang, q: EXAMPLES[lang].q })).map((ex) => (
          <button key={ex.lang} className="try-chip" lang={ex.lang} onClick={() => { setQ(ex.q); ask(ex.q) }}
                  disabled={busy || !cfg.key.trim()} title={!cfg.key.trim() ? tr('Add a key first', 'Añade una clave primero') : undefined}>
            <b>{ex.lang.toUpperCase()}</b> {ex.q}
          </button>
        ))}
      </div>

      {out?.error && <p className="try-search-error">{out.error}</p>}
      {out?.parts && (
        <div className="ask-answer">
          <p className="ask-q">{out.question}</p>
          <p>{out.parts.map((x, k) => (x.cite ? cite(x.cite, x.ok, k) : <span key={k}>{x.text}</span>))}</p>
          <p className="try-fine">
            {out.unknown.length
              ? tr(`⚠ ${out.unknown.length} citation(s) do not match any record and are marked — treat those statements as unsupported.`,
                   `⚠ ${out.unknown.length} cita(s) no corresponden a ningún registro y están marcadas: trata esas afirmaciones como no respaldadas.`)
              : out.cited.length
                ? tr(`✓ All ${out.cited.length} cited records exist in the evidence.`, `✓ Los ${out.cited.length} registros citados existen en la evidencia.`)
                : tr('No records cited: this answer is not backed by the evidence.', 'No cita registros: esta respuesta no está respaldada por la evidencia.')}
            {' '}{tr('Generated by', 'Generado por')} {p.label}. {tr('Preparatory evidence only; planners decide.', 'Solo evidencia preparatoria; deciden los planificadores.')}
          </p>
        </div>
      )}
    </section>
  )
}
