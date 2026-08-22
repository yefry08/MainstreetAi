import { useCallback, useState } from 'react'
import Scene from './scene/Scene'
import Bezel from './ui/Bezel'
import CameraControls from './ui/CameraControls'
import Atmosphere from './ui/Atmosphere'
import { useSimSocket } from './data/useSimSocket'

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
      <Scene
        onMapReady={onMapReady}
        onBasemapStatus={onBasemapStatus}
        frameRef={frameRef}
      />
      <Atmosphere map={map} />

      <header className="masthead">
        <div className="wordmark">
          <span className="wordmark-mark" />
          <span className="wordmark-name">MainstreetAi</span>
        </div>
        <div className="masthead-right">
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

      <CameraControls map={map} />

      <Bezel map={map} header={header} />
    </div>
  )
}
