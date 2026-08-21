import { useCallback, useEffect, useState } from 'react'
import MapView from './MapView'
import Dashboard from './Dashboard'
import Controls from './Controls'
import Inspector from './Inspector'
import Corridors from './Corridors'
import { useSimSocket, postControl } from './useSimSocket'

export default function App() {
  const { frameRef, header, status } = useSimSocket()
  const [meta, setMeta] = useState(null)
  const [signal, setSignal] = useState(null)
  const [toggles, setToggles] = useState({
    vehicles: true, roads: true, signals: true, bike: true,
  })

  useEffect(() => {
    fetch('/api/meta').then((r) => r.json()).then(setMeta).catch(() => {})
  }, [])

  const onPickSignal = useCallback((s) => {
    setSignal(s)
    postControl('watch', s.id)
  }, [])

  const closeInspector = useCallback(() => {
    setSignal(null)
    postControl('watch', null)
  }, [])

  const c = meta?.counts

  return (
    <div className="app">
      <MapView frameRef={frameRef} onPickSignal={onPickSignal} layerToggles={toggles} />

      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" />
          <div>
            <h1>Barcelona · AI Traffic Orchestration</h1>
            <div className="brand-sub">
              {c
                ? `${c.traffic_lights.toLocaleString()} signals · ${c.junctions.toLocaleString()} junctions · ${c.lane_km.toLocaleString()} lane-km · live SUMO twin`
                : 'loading network…'}
            </div>
          </div>
        </div>

        <div className="topright">
          <div className="clock">
            <span className="clock-time">{header?.clock ?? '--:--'}</span>
            <span className="clock-label">simulated</span>
          </div>
          <div className={`status ${status}`}>
            <i /> {status}
          </div>
        </div>
      </header>

      <div className="left-rail">
        <Dashboard header={header} />
        <Corridors header={header} />
        <DataProvenance meta={meta} />
      </div>

      <div className="right-rail">
        <Controls header={header} toggles={toggles} setToggles={setToggles} />
        <Inspector signal={signal} header={header} onClose={closeInspector} />
      </div>

      <EventTicker events={header?.events} />
      <ErrorBanner errors={header?.errors} status={status} />
    </div>
  )
}

/**
 * A worker process dying is otherwise invisible: the server keeps serving the
 * last snapshot it received, so the map just quietly stops advancing. During a
 * live demo you want to know that immediately rather than wonder why the clock
 * stopped.
 */
function ErrorBanner({ errors, status }) {
  const dead = errors?.length > 0
  if (!dead && status !== 'reconnecting') return null
  return (
    <div className="err-banner">
      {dead ? (
        <>
          <b>A simulation worker stopped.</b> Restart the server:{' '}
          <code>python server/app.py</code>
        </>
      ) : (
        <>
          <b>Lost the simulation server.</b> Reconnecting…
        </>
      )}
    </div>
  )
}

/**
 * Deliberately prominent. A judge should be able to tell in five seconds
 * exactly which parts of this are real and which are modelled.
 */
function DataProvenance({ meta }) {
  return (
    <div className="panel provenance">
      <div className="panel-head">
        <h2>What's real here</h2>
      </div>
      <ul>
        <li>
          <span className="tag real">real</span>
          Street network, lane counts, one-ways, bus &amp; bike lanes —
          OpenStreetMap via Overpass
        </li>
        <li>
          <span className="tag real">real</span>
          {meta?.counts?.traffic_lights?.toLocaleString() ?? '1,151'} traffic-light
          locations and their phase structure — OSM, imported by netconvert
        </li>
        <li>
          <span className="tag real">real</span>
          Cycle-lane network — the Ajuntament's own published dataset, Open Data
          BCN (<code>carril-bici</code>), ~209 km inside this extract
        </li>
        <li>
          <span className="tag real">real</span>
          Vehicle dynamics and emissions — SUMO microsimulation with the HBEFA3
          emission model
        </li>
        <li>
          <span className="tag synth">modelled</span>
          Trip origins and destinations — statistically generated. Barcelona
          publishes no open O/D matrix.
        </li>
        <li>
          <span className="tag synth">modelled</span>
          Bus movements run on real bus-permitted links, but are not live TMB
          vehicle positions.
        </li>
      </ul>
      <div className="prov-note">
        Percentages shown are simulation outcomes on synthetic demand, not field
        measurements from Barcelona streets.
      </div>
    </div>
  )
}

function EventTicker({ events }) {
  if (!events?.length) return null
  return (
    <div className="ticker">
      {events.slice(-3).map((e, i) => (
        <div key={i} className="tick">
          <b>{e.kind.replace('_', ' ')}</b> — {e.note}
        </div>
      ))}
    </div>
  )
}
