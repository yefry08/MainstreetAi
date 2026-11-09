import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { assetUrl } from '../data/assetUrl'
import { bbox, byRegion, citySlug } from '../city/cities'
import { SITE, SITE_CITIES } from '../site'
import { fetchCity } from '../city/osm'
import { SPARSE_TREES_PER_KM, analyseGreen, greenQuery } from '../green/plan'
import { trimGreen } from '../green/trim'
import { osmUrl } from '../transit/coverage'
import { useT } from '../i18n'

/**
 * Green: where to plant street trees and where a bike lane would do most.
 *
 * Ready-made results (scripts/bake-green.mjs) open instantly; any other city
 * in the catalogue is analysed live from OpenStreetMap by the same code
 * (green/plan.js). Every proposal links to the OSM ways behind it, and the
 * page says plainly when the area's tree mapping looks too thin to trust.
 */
const STYLE = 'https://tiles.openfreemap.org/styles/dark'
const SHOWN = 10
const REGION_ES = { 'Latin America': 'América Latina', 'North America': 'Norteamérica', Europe: 'Europa',
                    'Asia & Oceania': 'Asia y Oceanía', Africa: 'África' }
const fc = (features) => ({ type: 'FeatureCollection', features })
const lines = (ls, props = {}) => ls.map((l) => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: l } }))

export default function Green({ city = 'pristina', onCityParam }) {
  const tr = useT()
  const [baked, setBaked] = useState(null)
  const [data, setData] = useState(undefined)   // undefined loading | null failed | result
  const [error, setError] = useState(null)
  const [mode, setMode] = useState('trees')      // trees | bike
  const ref = useRef(null)
  const mapRef = useRef(null)
  const c = SITE_CITIES.find((x) => citySlug(x) === city) ?? SITE_CITIES.find((x) => citySlug(x) === SITE.defaultCity.green)

  useEffect(() => {
    fetch(assetUrl('green/index.json')).then((r) => (r.ok ? r.json() : null))
      .then((j) => setBaked(new Set(j?.cities ?? []))).catch(() => setBaked(new Set()))
  }, [])

  useEffect(() => {
    if (!baked) return
    const slug = citySlug(c)
    document.title = `MainstreetAi · ${tr('Green', 'Verde')} · ${c.name}`
    const ac = new AbortController()
    setData(undefined); setError(null)
    const load = baked.has(slug)
      ? fetch(assetUrl(`green/${slug}.json`), { signal: ac.signal }).then((r) => r.json())
      : fetchCity(bbox(c), { ql: greenQuery(bbox(c)), signal: ac.signal, timeoutMs: 120000 })
          .then((osm) => ({ slug, city: c.name, centre: [c.lat, c.lon], generated: new Date().toISOString(),
                            live: true, ...trimGreen(analyseGreen(osm.elements, [c.lat, c.lon], bbox(c))) }))
    load.then(setData).catch((e) => { if (e.name !== 'AbortError') { setError(e.message); setData(null) } })
    return () => ac.abort()
  }, [c, baked]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!data || !ref.current) return
    const map = new maplibregl.Map({ container: ref.current, style: STYLE,
      center: [data.centre[1], data.centre[0]], zoom: data.zoom ?? 14.2, attributionControl: { compact: true } })
    mapRef.current = map
    map.on('load', () => {
      map.addSource('trees', { type: 'geojson', data: fc(data.trees.points.map((pt) => ({
        type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pt } }))) })
      map.addSource('plant', { type: 'geojson', data: fc(data.planting.flatMap((g) => lines(g.lines))) })
      map.addSource('bike', { type: 'geojson', data: fc(lines(data.bike.lines)) })
      map.addSource('conn', { type: 'geojson', data: fc(data.bike.connectors.flatMap((x) => lines(x.lines))) })
      map.addSource('main', { type: 'geojson', data: fc(data.bike.arterials.flatMap((g) => lines(g.lines))) })
      map.addLayer({ id: 'plant', type: 'line', source: 'plant', paint: { 'line-color': '#f0a35e', 'line-width': 4, 'line-opacity': 0.85 } })
      map.addLayer({ id: 'trees', type: 'circle', source: 'trees', paint: { 'circle-color': '#4caf7a', 'circle-radius': 2.2, 'circle-opacity': 0.9 } })
      map.addLayer({ id: 'main', type: 'line', source: 'main', paint: { 'line-color': '#f0a35e', 'line-width': 3, 'line-dasharray': [2, 1.5], 'line-opacity': 0.7 } })
      map.addLayer({ id: 'bike', type: 'line', source: 'bike', paint: { 'line-color': '#4caf7a', 'line-width': 3 } })
      map.addLayer({ id: 'conn', type: 'line', source: 'conn', paint: { 'line-color': '#ffd84d', 'line-width': 5 } })
      showMode(map, mode)
    })
    return () => { map.remove(); mapRef.current = null }
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (mapRef.current?.isStyleLoaded()) showMode(mapRef.current, mode) }, [mode])

  const fly = (ls) => {
    const pts = ls.flat()
    if (!pts.length || !mapRef.current) return
    const b = pts.reduce((bb, [x, y]) => [Math.min(bb[0], x), Math.min(bb[1], y), Math.max(bb[2], x), Math.max(bb[3], y)],
                         [Infinity, Infinity, -Infinity, -Infinity])
    mapRef.current.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: 17, duration: 800 })
  }
  const picker = (
    <select className="green-pick" value={citySlug(c)} aria-label={tr('City', 'Ciudad')}
            onChange={(e) => onCityParam?.(e.target.value)}>
      {byRegion(SITE_CITIES).map(({ region, cities }) => (
        <optgroup key={region} label={tr(region, REGION_ES[region] ?? region)}>
          {cities.map((x) => <option key={citySlug(x)} value={citySlug(x)}>
            {x.flag} {x.name}{baked && !baked.has(citySlug(x)) ? ` (${tr('live', 'en vivo')})` : ''}</option>)}
        </optgroup>
      ))}
    </select>
  )

  if (!data) {
    return (
      <div className="transit-page">
        <header className="try-head"><p className="land-eyebrow">{tr('Trees · bike lanes · open data', 'Árboles · ciclovías · datos abiertos')}</p>
          <h1>{c.flag} {c.name}</h1>{picker}</header>
        {error
          ? <p className="try-search-error">{error}</p>
          : <p className="try-fine">{baked && !baked.has(citySlug(c))
              ? tr('Analysing this city live from OpenStreetMap — this can take up to a minute.',
                   'Analizando esta ciudad en vivo desde OpenStreetMap: puede tardar hasta un minuto.')
              : tr('Loading…', 'Cargando…')}</p>}
      </div>
    )
  }

  const t = { ...data.trees, sparse: data.trees.perKm < SPARSE_TREES_PER_KM }
  // A whole district (a baked administrative area) gets a longer list.
  const shown = data.area ? 20 : SHOWN
  const where = data.area
    ? tr(`the whole of ${data.city} (its official boundary in OpenStreetMap)`, `todo ${data.city} (su límite oficial en OpenStreetMap)`)
    : tr('the ~2.5 km area', 'la zona de ~2,5 km')
  const b = data.bike
  const pt = data.plantingTotal
  return (
    <div className="transit-page">
      <header className="try-head">
        <p className="land-eyebrow">{tr('Trees · bike lanes · open data', 'Árboles · ciclovías · datos abiertos')}</p>
        <h1>{c.flag} {data.city}: {tr('where to plant, where to ride', 'dónde plantar, dónde pedalear')}</h1>
        <div className="green-bar">
          {picker}
          <div className="try-switch" role="group" aria-label={tr('Plan', 'Plan')}>
            <button className={mode === 'trees' ? 'on' : ''} onClick={() => setMode('trees')}>🌳 {tr('Trees', 'Árboles')}</button>
            <button className={mode === 'bike' ? 'on' : ''} onClick={() => setMode('bike')}>🚲 {tr('Bike lanes', 'Ciclovías')}</button>
          </div>
        </div>
      </header>

      {mode === 'trees' ? (
        <dl className="land-stats transit-stats">
          <div><dt>{tr('Trees mapped', 'Árboles mapeados')}</dt><dd>{t.count.toLocaleString()}</dd></div>
          <div><dt>{tr('Per km of street', 'Por km de calle')}</dt><dd className={t.sparse ? 'bad' : ''}>{t.perKm}</dd></div>
          <div><dt>{tr('Streets with no shade', 'Calles sin sombra')}</dt><dd className="bad">{pt.streets} · {pt.km} km</dd></div>
          <div><dt>{tr('Room for, about', 'Espacio para unos')}</dt><dd className="good">{pt.room.toLocaleString()} {tr('trees', 'árboles')}</dd></div>
        </dl>
      ) : (
        <dl className="land-stats transit-stats">
          <div><dt>{tr('Bike network mapped', 'Red ciclista mapeada')}</dt><dd>{b.existingKm} km</dd></div>
          <div><dt>{tr('In separate pieces', 'En tramos separados')}</dt><dd className={b.pieces > 1 ? 'bad' : ''}>{b.pieces}</dd></div>
          <div><dt>{tr('Streets that would join them', 'Calles que los unirían')}</dt><dd className="good">{b.connectorsTotal}</dd></div>
          <div><dt>{tr('Main streets with no lane', 'Avenidas sin ciclovía')}</dt><dd className="bad">{b.arterialsKm} km</dd></div>
        </dl>
      )}
      {mode === 'trees' && t.sparse && (
        <p className="try-warn">
          {tr(`Only ${t.perKm} trees are mapped per km of street here — far fewer than a city usually has. OpenStreetMap is probably missing most of this area’s trees, so treat “no shade” as “no trees on the map”, and check on the ground or against the city’s own tree inventory.`,
              `Aquí solo hay ${t.perKm} árboles mapeados por km de calle, muchos menos de lo normal en una ciudad. Probablemente a OpenStreetMap le faltan la mayoría de los árboles de esta zona, así que “sin sombra” significa “sin árboles en el mapa”: compruébalo sobre el terreno o con el inventario de arbolado de la ciudad.`)}
        </p>
      )}

      <div className="transit-grid">
        <div className="transit-map" ref={ref} role="img"
             aria-label={mode === 'trees'
               ? tr('Map of mapped trees and streets without shade.', 'Mapa de árboles mapeados y calles sin sombra.')
               : tr('Map of the bike network, streets that would join it, and main streets without a lane.',
                    'Mapa de la red ciclista, las calles que la unirían y las avenidas sin ciclovía.')} />
        <section className="transit-list">
          {mode === 'trees' ? (
            <>
              <h2>{tr('Streets to plant first', 'Calles para plantar primero')}</h2>
              <p className="try-fine"><span className="green-key plant" /> {tr('no mapped tree within 12 m', 'sin árbol mapeado a menos de 12 m')} · <span className="green-key tree" /> {tr('trees', 'árboles')}</p>
              <ol>
                {data.planting.slice(0, shown).map((g, i) => (
                  <li key={i}>
                    <button onClick={() => fly(g.lines)}>
                      <b>{g.name ?? tr('Unnamed street', 'Calle sin nombre')}</b>
                      <span>{g.lengthM} m · {tr(`room for ~${g.room} trees`, `espacio para ~${g.room} árboles`)}</span>
                    </button>
                    <p className="transit-evidence">{g.ways.slice(0, 4).map((id, k) => (
                      <a key={id} href={osmUrl(id)} target="_blank" rel="noopener noreferrer">OSM {k + 1}</a>))}</p>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <>
              <h2>{tr('Bike lanes that join the network', 'Ciclovías que unen la red')}</h2>
              <p className="try-fine"><span className="green-key conn" /> {tr('joins two separate pieces', 'une dos tramos separados')} · <span className="green-key bike" /> {tr('existing', 'existente')} · <span className="green-key main" /> {tr('main street, no lane', 'avenida sin ciclovía')}</p>
              <ol>
                {b.connectors.slice(0, shown).map((x) => (
                  <li key={x.id}>
                    <button onClick={() => fly(x.lines)}>
                      <b>{x.name ?? tr('Unnamed street', 'Calle sin nombre')}</b>
                      <span>{tr(`${x.lengthM} m of lane joins ${x.joins} pieces (${x.joinsKm} km)`, `${x.lengthM} m de ciclovía unen ${x.joins} tramos (${x.joinsKm} km)`)}</span>
                    </button>
                    <p className="transit-evidence"><a href={osmUrl(x.id)} target="_blank" rel="noopener noreferrer">OSM</a></p>
                  </li>
                ))}
              </ol>
              {!b.connectors.length && <p className="try-fine">{tr('No single street joins two pieces of the mapped network here.', 'Aquí ninguna calle sola une dos tramos de la red mapeada.')}</p>}
              <h2 className="green-sub">{tr('Main streets with no bike lane', 'Avenidas sin ciclovía')}</h2>
              <ol>
                {b.arterials.slice(0, 5).map((g, i) => (
                  <li key={i}><button onClick={() => fly(g.lines)}><b>{g.name ?? tr('Unnamed', 'Sin nombre')}</b><span>{g.lengthM} m</span></button></li>
                ))}
              </ol>
            </>
          )}
        </section>
      </div>

      <p className="try-note">
        <b>{tr('How this is worked out.', 'Cómo se calcula.')}</b>{' '}
        {mode === 'trees'
          ? tr(`Every street in ${where} is checked for mapped trees within 12 m. Streets of 60 m or more with under one tree per 100 m are listed, longest first; “room for” assumes one tree every 10 m on one side, and knows nothing of pavement width or pipes below.`,
               `Cada calle de ${where} se compara con los árboles mapeados a menos de 12 m. Se listan las calles de 60 m o más con menos de un árbol por cada 100 m, de la más larga a la más corta; el “espacio para” supone un árbol cada 10 m en un lado, y no sabe nada del ancho de la acera ni de las tuberías.`)
          : tr('The bike network is every way OpenStreetMap marks for cycling. A street with no lane that touches two separate pieces of it is listed first, ranked by how much network it would join per metre built.',
               'La red ciclista es todo lo que OpenStreetMap marca para bicicleta. Primero se listan las calles sin ciclovía que tocan dos tramos separados de esa red, ordenadas por cuánta red unirían por cada metro construido.')}
        {' '}{tr('These are prompts for a planner to look at, not designs.', 'Son avisos para que un planificador los revise, no diseños.')}
      </p>
      <p className="land-credits">
        {tr('Trees, streets and cycleways © OpenStreetMap contributors (ODbL)', 'Árboles, calles y ciclovías © colaboradores de OpenStreetMap (ODbL)')}
        {data.live ? tr(', read live now.', ', leídos en vivo ahora.') : `, ${tr('read', 'leídos el')} ${new Date(data.generated).toLocaleDateString()}.`}
      </p>
    </div>
  )
}

function showMode(map, mode) {
  const on = { trees: ['plant', 'trees'], bike: ['bike', 'conn', 'main'] }[mode]
  for (const id of ['plant', 'trees', 'bike', 'conn', 'main']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on.includes(id) ? 'visible' : 'none')
  }
}
