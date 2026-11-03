import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { assetUrl } from '../data/assetUrl'
import { toHash } from '../data/route'
import { osmUrl } from '../transit/coverage'
import { useT } from '../i18n'

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
          <a href={toHash('transit', 'pristina')}>Pristina →</a></p>
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
                  <b>{g.homes} {tr('homes', 'viviendas')}</b>
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

      <p className="try-note">
        <b>{tr('What this is not.', 'Qué no es esto.')}</b>{' '}
        {tr('Proof of unmet demand. OpenStreetMap can miss stops (a gap in the map, not in the service), homes stand in for riders, and the distance is straight-line rather than walking. With the city’s own GPS, schedule and complaint data, the same flags would rest on ridership instead.',
            'Una prueba de demanda insatisfecha. OpenStreetMap puede no tener alguna parada (un hueco en el mapa, no en el servicio), las viviendas son una aproximación a los usuarios, y la distancia es en línea recta, no a pie. Con los datos propios de la ciudad (GPS, horarios y quejas), los mismos avisos se basarían en el uso real.')}
      </p>
      <p className="try-note">
        <b>{tr('Traffic in the centre.', 'El tráfico del centro.')}</b>{' '}
        <a href={toHash('yours', 'pristina')}>
          {tr('Open Pristina’s traffic twin: real streets, live traffic, and what adaptive signals change →',
              'Abre el gemelo de tráfico de Pristina: calles reales, tráfico en vivo y lo que cambian los semáforos adaptativos →')}
        </a>
      </p>
      <p className="land-credits">
        {tr('Homes, stops and Trafiku Urban routes © OpenStreetMap contributors (ODbL), read',
            'Viviendas, paradas y rutas de Trafiku Urban © colaboradores de OpenStreetMap (ODbL), leídos el')}{' '}
        {new Date(data.generated).toLocaleDateString()}.
      </p>
    </div>
  )
}
