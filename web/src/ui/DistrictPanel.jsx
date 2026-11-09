import { useEffect, useMemo, useState } from 'react'
import { assetUrl } from '../data/assetUrl'
import { predictDay, predictHour, kindLabel } from '../predict/forecast'
import { rainFactor } from '../predict/generators'
import { useLang, useT } from '../i18n'

/**
 * The Distrito Nacional twin's planning panel, over the 3D scene.
 *
 * PREDICTION: what will congest, where and why -- schools letting out, offices
 * emptying, malls filling, a game night, rain -- hour by hour, from the
 * district's traffic generators (src/predict). The same forecast drives the
 * twin: its events are in the simulated traffic and the AI controller is told
 * them in advance (server/controllers.py, "forecast:" holds).
 *
 * BIKE LANES & SHADE: the mapped cycling network coloured by how much of it is
 * in shade at 9, 12, 15 and 17 h on a mid-July day, from building heights,
 * trees and the sun (src/green/shade.js), with the stretches that would join
 * its pieces.
 */
const DAYS = [['Sun', 'Dom'], ['Mon', 'Lun'], ['Tue', 'Mar'], ['Wed', 'Mié'], ['Thu', 'Jue'], ['Fri', 'Vie'], ['Sat', 'Sáb']]
const KIND_COLOR = { school_private: '#ff8a5c', school_public: '#ffb38a', university: '#c58aff', office: '#8ab4ff',
  mall: '#ffd84d', supermarket: '#e6c86e', hospital: '#ff6b81', stadium: '#ff3d3d', church: '#b0b0b0' }
const SRC = { gen: 'dn-gen', hot: 'dn-hot', bike: 'dn-bike', conn: 'dn-conn', trees: 'dn-trees' }
const fc = (features) => ({ type: 'FeatureCollection', features })
// Santo Domingo is UTC-4 all year.
const nowDR = () => { const d = new Date(Date.now() - 4 * 3600e3); return { day: d.getUTCDay(), hour: d.getUTCHours() } }

export default function DistrictPanel({ map, district = 'santo_domingo', slug = 'santo-domingo' }) {
  const tr = useT()
  const lang = useLang()
  const [view, setView] = useState('predict')
  const [pred, setPred] = useState(null)
  const [green, setGreen] = useState(null)
  const [shade, setShade] = useState(null)
  const [trees, setTrees] = useState(null)
  const [rainMm, setRainMm] = useState(null)       // live forecast, mm per hour of today
  const [{ day, hour }, setWhen] = useState(nowDR)
  const [game, setGame] = useState(false)
  const [shadeHour, setShadeHour] = useState(15)

  useEffect(() => {
    const get = (u, set) => fetch(assetUrl(u)).then((r) => (r.ok ? r.json() : null)).then(set).catch(() => set(null))
    get(`predict/${district}.json`, setPred)
    get(`green/${slug}.json`, setGreen)
    get(`shade/${slug}.json`, setShade)
    get(`trees/${slug}.json`, setTrees)
    // Live rain for the next two days (Open-Meteo: free, no key).
    fetch('https://api.open-meteo.com/v1/forecast?latitude=18.4745&longitude=-69.9395&hourly=precipitation' +
          '&timezone=America%2FSanto_Domingo&forecast_days=2')
      .then((r) => r.json()).then((j) => setRainMm(j?.hourly?.precipitation ?? null)).catch(() => setRainMm(null))
  }, [district, slug])

  // Rain applies when the chosen day is today; other days are planned dry.
  const today = nowDR().day
  const mm = day === today && rainMm ? rainMm[hour] ?? 0 : 0
  const rain = rainFactor(mm)
  const p = useMemo(() => (pred ? predictHour(pred, { day, hour, rain, game }) : null), [pred, day, hour, rain, game])
  const line = useMemo(() => (pred ? predictDay(pred, { day, game }) : null), [pred, day, game])

  // ---- map layers ---------------------------------------------------------------
  useEffect(() => {
    if (!map) return
    const ensure = () => {
      if (!map.isStyleLoaded()) return false
      for (const id of Object.values(SRC)) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: fc([]) })
      if (!map.getLayer(SRC.bike)) {
        // Canopy cells under everything else: red where the deficit is worst.
        map.addLayer({ id: SRC.trees, type: 'fill', source: SRC.trees, paint: {
          'fill-color': ['interpolate', ['linear'], ['get', 'canopy'], 0, '#d9412b', 0.15, '#e8a33d', 0.3, '#3fbf6f'],
          'fill-opacity': 0.42, 'fill-outline-color': 'rgba(0,0,0,0)' } })
        map.addLayer({ id: SRC.bike, type: 'line', source: SRC.bike, paint: {
          'line-width': 4, 'line-color': ['interpolate', ['linear'], ['get', 'shade'], 0, '#ff7a3d', 0.5, '#e6d34d', 1, '#3fbf6f'] } })
        map.addLayer({ id: SRC.conn, type: 'line', source: SRC.conn, paint: { 'line-width': 5, 'line-color': '#ffd84d', 'line-dasharray': [1.5, 1] } })
        map.addLayer({ id: SRC.hot, type: 'circle', source: SRC.hot, paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'cars'], 0, 4, 200, 22],
          'circle-color': 'rgba(255,61,61,0.18)', 'circle-stroke-color': '#ff3d3d', 'circle-stroke-width': 2 } })
        map.addLayer({ id: SRC.gen, type: 'circle', source: SRC.gen, paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'cars'], 0, 3, 300, 14],
          'circle-color': ['get', 'color'], 'circle-stroke-color': '#0b0e15', 'circle-stroke-width': 1 } })
      }
      return true
    }
    let tries = 0
    const t = setInterval(() => { if (ensure() || ++tries > 40) clearInterval(t) }, 250)
    return () => {
      clearInterval(t)
      for (const id of [SRC.gen, SRC.hot, SRC.conn, SRC.bike, SRC.trees]) {
        try { if (map.getLayer(id)) map.removeLayer(id); if (map.getSource(id)) map.removeSource(id) } catch { /* style swap */ }
      }
    }
  }, [map])

  useEffect(() => {
    if (!map?.getSource(SRC.gen)) return
    const pt = (lon, lat, props) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [lon, lat] } })
    const showPredict = view === 'predict' && p
    map.getSource(SRC.gen).setData(fc(showPredict ? p.active.map((a) =>
      pt(a.gen.lon, a.gen.lat, { cars: a.cars, color: KIND_COLOR[a.gen.kind] ?? '#fff' })) : []))
    map.getSource(SRC.hot).setData(fc(showPredict ? p.hotspots.slice(0, 15).map((h) =>
      pt(h.signal.lon, h.signal.lat, { cars: h.cars })) : []))
    const showBike = view === 'bike' && green
    const sh = shade?.hours.find((x) => x.hour === shadeHour)
    map.getSource(SRC.bike).setData(fc(showBike ? green.bike.lines.map((l, i) => ({ type: 'Feature',
      properties: { shade: sh?.bike[i] ?? 0.5 }, geometry: { type: 'LineString', coordinates: l } })) : []))
    map.getSource(SRC.conn).setData(fc(showBike ? green.bike.connectors.flatMap((c) => c.lines.map((l) => ({
      type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: l } }))) : []))
    const showTrees = view === 'trees' && trees
    const half = trees ? trees.cellM / 2 : 0
    map.getSource(SRC.trees).setData(fc(showTrees ? trees.cells.map((c) => {
      const dy = half / 110540, dx = half / (111320 * Math.cos((c.lat * Math.PI) / 180))
      return { type: 'Feature', properties: { canopy: c.canopy },
        geometry: { type: 'Polygon', coordinates: [[[c.lon - dx, c.lat - dy], [c.lon + dx, c.lat - dy],
          [c.lon + dx, c.lat + dy], [c.lon - dx, c.lat + dy], [c.lon - dx, c.lat - dy]]] } }
    }) : []))
  }, [map, view, p, green, shade, shadeHour, trees])

  const max = line ? Math.max(...line, 1) : 1
  const sh = shade?.hours.find((x) => x.hour === shadeHour)
  return (
    <aside className="dn-panel glass">
      <div className="try-switch" role="group">
        <button className={view === 'predict' ? 'on' : ''} onClick={() => setView('predict')}>{tr('Prediction', 'Predicción')}</button>
        <button className={view === 'bike' ? 'on' : ''} onClick={() => setView('bike')}>{tr('Bike lanes & shade', 'Ciclovías y sombra')}</button>
        <button className={view === 'trees' ? 'on' : ''} onClick={() => setView('trees')}>{tr('Trees', 'Árboles')}</button>
      </div>

      {view === 'trees' && (trees ? (() => {
        const t = trees.totals
        const n = (v) => Math.round(v).toLocaleString(lang === 'es' ? 'es' : 'en')
        const pct = (v) => `${(v * 100).toFixed(1)}%`
        return (
          <>
            <p className="dn-sub">{tr('Tree canopy measured from satellite, against the 30% every neighbourhood should have.',
                                     'Copa arbórea medida desde satélite, frente al 30 % que debería tener cada barrio.')}</p>
            <dl className="land-stats dn-stats">
              <div><dt>{tr('Canopy today', 'Copa hoy')}</dt><dd className="bad">{pct(t.canopyNow)}</dd></div>
              <div><dt>{tr('Trees today, about', 'Árboles hoy, aprox.')}</dt><dd>{n(t.treesNow)}</dd></div>
              <div><dt>{tr('Missing to reach 30%', 'Faltan para llegar al 30 %')}</dt><dd className="bad">{n(t.missing)}</dd></div>
              <div><dt>{tr('Room to plant', 'Se pueden plantar')}</dt><dd className="good">{n(t.plant)}</dd></div>
            </dl>
            <p className="try-fine">
              {tr(`${n(t.onStreets)} along streets (one every 10 m) and ${n(t.onOpen)} on open ground. Planting them all takes canopy from ${pct(t.canopyNow)} to ${pct(t.canopyAfter)}.`,
                  `${n(t.onStreets)} a lo largo de las calles (uno cada 10 m) y ${n(t.onOpen)} en terrenos abiertos. Plantarlos todos lleva la copa de ${pct(t.canopyNow)} a ${pct(t.canopyAfter)}.`)}
            </p>
            <h3 className="land-strip-head">{tr('Climate benefits, at maturity', 'Beneficios climáticos, en madurez')}</h3>
            <dl className="land-stats dn-stats">
              <div><dt>{tr('CO₂ absorbed a year', 'CO₂ absorbido al año')}</dt><dd className="good">{n(t.co2TYr[1])} t</dd></div>
              <div><dt>{tr('Rain intercepted a year', 'Lluvia interceptada al año')}</dt><dd className="good">{n(t.waterM3Yr)} m³</dd></div>
              <div><dt>{tr('Cooler air, district average', 'Aire más fresco, media del distrito')}</dt><dd className="good">−{t.coolingC[1]} °C</dd></div>
            </dl>
            <p className="try-fine">
              {tr(`Ranges: CO₂ ${n(t.co2TYr[0])}–${n(t.co2TYr[2])} t/yr; cooling ${t.coolingC[0]}–${t.coolingC[2]} °C, and well above that in the neighbourhoods with least canopy.`,
                  `Rangos: CO₂ ${n(t.co2TYr[0])}–${n(t.co2TYr[2])} t/año; enfriamiento ${t.coolingC[0]}–${t.coolingC[2]} °C, y bastante más en los barrios con menos copa.`)}
            </p>
            <h3 className="land-strip-head">{tr('Where to plant first', 'Dónde plantar primero')}</h3>
            <ol className="dn-hot">
              {trees.neighbourhoods.slice(0, 8).map((g) => {
                const gain = (g.plant * 50) / (g.cells * trees.cellM * trees.cellM)
                return (
                  <li key={g.name}>
                    <button className="dn-link" onClick={() => map?.flyTo({ center: [g.lon, g.lat], zoom: 15, duration: 900 })}>
                      <b>{g.name}</b> <em>{tr('canopy', 'copa')} {Math.round(g.canopy * 100)}%</em>
                    </button>
                    <span>{tr(`plant ${n(g.plant)} (${n(g.onStreets)} on streets) · missing ${n(g.missing)} · ~${(gain * 100 * 0.05).toFixed(1)} °C cooler`,
                              `plantar ${n(g.plant)} (${n(g.onStreets)} en calles) · faltan ${n(g.missing)} · ~${(gain * 100 * 0.05).toFixed(1)} °C más fresco`)}</span>
                  </li>
                )
              })}
            </ol>
            <p className="try-fine">
              {tr('Canopy: ESA WorldCover 10 m (2021), so single street trees narrower than a pixel are undercounted. Mature crown 50 m²; “room” is an upper bound — pavement width, cables and pipes decide the final number on each street. Benefits are literature averages (i-Tree; cooling studies), not measurements of these trees.',
                  'Copa: ESA WorldCover 10 m (2021), así que los árboles de calle aislados, más estrechos que un píxel, se cuentan de menos. Copa madura de 50 m²; el “espacio” es un máximo: el ancho de acera, los cables y las tuberías deciden la cifra final en cada calle. Los beneficios son promedios de la literatura (i-Tree; estudios de enfriamiento), no mediciones de estos árboles.')}
            </p>
          </>
        )
      })() : <p className="try-fine">{tr('Tree analysis not computed yet for this area.', 'Análisis de árboles aún no calculado para esta zona.')}</p>)}

      {view === 'predict' && (
        <>
          <p className="dn-sub">{tr('What will congest, where, and why.', 'Qué se va a congestionar, dónde y por qué.')}</p>
          <div className="dn-row">
            <select value={day} onChange={(e) => setWhen({ day: +e.target.value, hour })} aria-label={tr('Day', 'Día')}>
              {DAYS.map((d, i) => <option key={i} value={i}>{lang === 'es' ? d[1] : d[0]}</option>)}
            </select>
            <label className="dn-game"><input type="checkbox" checked={game} onChange={(e) => setGame(e.target.checked)} />
              {tr('Game at the Quisqueya', 'Partido en el Quisqueya')}</label>
          </div>
          {line && (
            <div className="dn-bars" role="img" aria-label={tr('Predicted extra cars by hour', 'Coches extra previstos por hora')}>
              {line.map((v, i) => (
                <button key={i} className={i === hour ? 'on' : ''} style={{ height: `${Math.max(3, (v / max) * 100)}%` }}
                        title={`${i}:00 · ${Math.round(v)}`} onClick={() => setWhen({ day, hour: i })} />
              ))}
            </div>
          )}
          <p className="dn-hour"><b>{String(hour).padStart(2, '0')}:00</b>
            {' · '}{p ? tr(`~${Math.round(p.total).toLocaleString()} extra car trips from ${p.active.length} places`,
                            `~${Math.round(p.total).toLocaleString('es')} viajes en coche extra desde ${p.active.length} lugares`) : '…'}
            {day === today && (mm > 0
              ? <span className="dn-rain">{tr(` · rain ${mm.toFixed(1)} mm/h`, ` · lluvia ${mm.toFixed(1)} mm/h`)}</span>
              : rainMm ? <span className="dn-dry">{tr(' · dry', ' · sin lluvia')}</span> : null)}
          </p>
          <ol className="dn-hot">
            {p?.hotspots.slice(0, 6).map((h) => (
              <li key={h.signal.id}>
                <b>{h.signal.name ?? h.signal.id}</b> <em>+{Math.round(h.cars)}</em>
                <span>{h.reasons.map((r) => `${r.dir === 'in' ? '→' : '←'} ${r.name ?? kindLabel(r.kind, lang)}`).join(' · ')}</span>
              </li>
            ))}
          </ol>
          {p && !p.hotspots.length && <p className="try-fine">{tr('Nothing predicted this hour.', 'Nada previsto a esta hora.')}</p>}
          <p className="try-fine">
            {tr('Profiles (school gates 6:45 and 13:00, offices 17:00, malls 18-20 h…) are stated assumptions, to be replaced with counts and timetables. The twin runs a 12% sample of these trips, and its AI is told the forecast ten minutes ahead.',
                'Los perfiles (entrada de colegios 6:45 y salida 13:00, oficinas 17:00, centros comerciales 18-20 h…) son supuestos declarados, a sustituir por conteos y horarios reales. El gemelo simula una muestra del 12% de estos viajes, y su IA recibe la previsión diez minutos antes.')}
          </p>
        </>
      )}

      {view === 'bike' && (
        <>
          <p className="dn-sub">{tr('How much of the bike network is in shade, 15 July.', 'Cuánta red ciclista está a la sombra, 15 de julio.')}</p>
          <div className="try-switch" role="group">
            {(shade?.hours ?? []).map((x) => (
              <button key={x.hour} className={shadeHour === x.hour ? 'on' : ''} onClick={() => setShadeHour(x.hour)}>{x.hour}:00</button>
            ))}
          </div>
          {sh ? (
            <dl className="land-stats dn-stats">
              <div><dt>{tr('Bike network in shade', 'Red ciclista a la sombra')}</dt><dd>{Math.round(sh.bikeShaded * 100)}%</dd></div>
              <div><dt>{tr('Sun height', 'Altura del sol')}</dt><dd>{sh.altitude}°</dd></div>
            </dl>
          ) : <p className="try-fine">{tr('Shade not computed yet for this area.', 'Sombra aún no calculada para esta zona.')}</p>}
          <p className="try-fine">
            <span className="green-key" style={{ background: '#3fbf6f' }} /> {tr('shaded', 'sombra')} ·{' '}
            <span className="green-key" style={{ background: '#ff7a3d' }} /> {tr('full sun', 'pleno sol')} ·{' '}
            <span className="green-key conn" /> {tr('stretch that would join the network', 'tramo que uniría la red')}
          </p>
          {shade && (
            <p className="try-fine">
              {tr(`${shade.buildings.toLocaleString()} buildings (${Math.round(shade.heightAssumedShare * 100)}% with height assumed at two storeys) and ${shade.trees.toLocaleString()} mapped trees cast the shadows.`,
                  `Proyectan la sombra ${shade.buildings.toLocaleString('es')} edificios (al ${Math.round(shade.heightAssumedShare * 100)}% se le supone una altura de dos pisos) y ${shade.trees.toLocaleString('es')} árboles mapeados.`)}
            </p>
          )}
        </>
      )}
    </aside>
  )
}
