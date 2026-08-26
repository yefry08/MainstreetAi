import { useCallback, useState } from 'react'
import Scene from './scene/Scene'
import Bezel from './ui/Bezel'
import CameraControls from './ui/CameraControls'
import Atmosphere from './ui/Atmosphere'
import ClimatePanel from './ui/ClimatePanel'
import LiveCity from './ui/LiveCity'
import ModeLegend from './ui/ModeLegend'
import TimeControl from './ui/TimeControl'
import PixelScene from './pixel/PixelScene'
import AiToggle from './pixel/AiToggle'
import { useSimSocket } from './data/useSimSocket'

/**
 * The 2D pixel restructure runs behind ?mode=pixel until it has earned the
 * default. Both consume the same WebSocket frames and the same SUMO twins, so
 * this is purely a renderer swap and the two can be compared side by side on
 * the same running simulation rather than from memory.
 */
const PIXEL_MODE =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('mode') === 'pixel'

/**
 * Direction prototype: the empty 3D city, a free camera, and the instruments
 * that frame it. No traffic, no simulation, no WebSocket — the point of this
 * pass is to settle how the thing looks and feels to move through.
 */
const BASEMAP_LABEL = {
  loading: 'Basemap · loading',
  ready: 'Barcelona · Signal Twin',
  fallback: 'Basemap · fallback',
  offline: 'Basemap · offline',
}

export default function App() {
  const [map, setMap] = useState(null)
  const [basemap, setBasemap] = useState('loading')
  const onMapReady = useCallback((m) => setMap(m), [])
  const onBasemapStatus = useCallback((s) => setBasemap(s), [])
  const { frameRef, header, status } = useSimSocket()

  return (
    <div className="app">
      {PIXEL_MODE ? (
        <>
          <PixelScene frameRef={frameRef} />
          <AiToggle />
        </>
      ) : (
        <>
          <Scene
            onMapReady={onMapReady}
            onBasemapStatus={onBasemapStatus}
            frameRef={frameRef}
          />
          <Atmosphere map={map} />
        </>
      )}

      <header className="masthead">
        <div className="wordmark">
          <span className="wordmark-mark" />
          <span className="wordmark-name">MainstreetAi</span>
        </div>
        <div className="masthead-right">
          {/* The one live thing on a screen full of simulation. */}
          <LiveCity />
          {header?.weather?.available && (
            <span
              className={`wx ${
                header.weather.condition !== 'clear' ? 'wet' : ''
              }`}
              title={`${header.weather.source} — observed ${header.weather.observed_at}`}
            >
              <span className="wx-temp">
                {Math.round(header.weather.temperature_c)}°
              </span>
              <span className="wx-label">{header.weather.label}</span>
            </span>
          )}
          {header?.day && <span className="masthead-tag">{header.day}</span>}
          {header?.clock && (
            <span className="masthead-clock value">{header.clock}</span>
          )}
          <span className="masthead-tag">
            {status === 'live' ? BASEMAP_LABEL[basemap] : `Simulation · ${status}`}
          </span>
          <span className={`masthead-dot ${
            status === 'live' ? 'ready' : basemap === 'offline' ? 'offline' : ''
          }`} />
        </div>
      </header>

      <aside className="rail">
        <ClimatePanel header={header} />
        <ModeLegend header={header} />
        <TimeControl header={header} />
      </aside>

      {/* Both read the MapLibre instance for camera state, which the 2D scene
          does not have. They are hidden rather than adapted: giving them a
          shim that reports a fake bearing would put wrong numbers on an
          instrument panel, which is worse than an absent one. */}
      {!PIXEL_MODE && <CameraControls map={map} />}
      {!PIXEL_MODE && <Bezel map={map} header={header} />}
    </div>
  )
}
