import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import Scene from './scene/Scene'
import { PRESETS } from './scene/cameraPresets'
import Atmosphere from './ui/Atmosphere'
import Bezel from './ui/Bezel'
import CameraControls from './ui/CameraControls'
import Navbar from './ui/Navbar'
import ImpactPanel from './ui/ImpactPanel'


import LiveCity from './ui/LiveCity'

import AiToggle from './pixel/AiToggle'
import { useSimSocket } from './data/useSimSocket'
import { useReplayFrames } from './data/useReplayFrames'

/**
 * Split out of the Home bundle.
 *
 * Home is the 3D scene, and it already has to parse three.js and MapLibre
 * before it can draw. The pixel renderer, the district picker and the two
 * reading pages are not on that path -- none of them render until a tab is
 * clicked -- so making Home wait for them to download and parse is pure cost.
 * They arrive on demand, by which point the scene is already running.
 */
const Contact = lazy(() => import('./ui/Contact'))
const Research = lazy(() => import('./ui/Research'))
const TryCity = lazy(() => import('./ui/TryCity'))
const PixelScene = lazy(() => import('./pixel/PixelScene'))
const ReplayScene = lazy(() => import('./pixel/ReplayScene'))

/**
 * Two renderers, two jobs.
 *
 * HOME is the 3D Barcelona scene: MapLibre basemap, three.js traffic, a real
 * camera. It is the hero, and it is what this project has always been.
 *
 * TRY YOUR CITY is the 2D pixel renderer -- a different thing for a different
 * purpose, an illustrated per-district view that can be baked for cities the
 * 3D pipeline has no basemap for. They are not two versions of one scene, and
 * neither replaces the other.
 *
 * An earlier pass made the pixel renderer the hero and stopped mounting the 3D
 * scene at all. Nothing was deleted -- every three.js module and its tests
 * stayed in the repo -- but an unmounted component is an absent one, so the
 * simulation this project is named after was simply not on screen.
 *
 * TWO RUNTIMES
 * With the Python server the scene is live over a WebSocket. On a static host
 * there is no server, so the pixel side plays a recording instead. Everything
 * above the scene is identical in both, which is what stops the deployed page
 * drifting away from the one that gets developed.
 */
const REPLAY_ONLY = import.meta.env?.VITE_REPLAY_ONLY === '1'

const BASEMAP_LABEL = {
  loading: 'Basemap · loading',
  ready: 'Barcelona · Signal Twin',
  fallback: 'Basemap · fallback',
  offline: 'Basemap · offline',
}

export default function App() {
  const [tab, setTab] = useState('home')
  const [mode, setMode] = useState('night')
  const [chrome, setChrome] = useState(true)
  const [district, setDistrict] = useState('shibuya')
  const [twins, setTwins] = useState(null)
  const [twin, setTwin] = useState('ai')

  const [map, setMap] = useState(null)
  const [basemap, setBasemap] = useState('loading')
  const onMapReady = useCallback((m) => setMap(m), [])
  const onBasemapStatus = useCallback((s) => setBasemap(s), [])

  const { frameRef: liveRef, header, status } = useSimSocket({ enabled: !REPLAY_ONLY })

  // On a static host the 3D hero has no socket to draw from. The Barcelona
  // recording is in the identical frame shape, so it drives the same ref and
  // the scene never learns the difference.
  const { frameRef: recordedRef, meta: recordedMeta } =
    useReplayFrames({ enabled: REPLAY_ONLY, district: 'barcelona', twin })
  const frameRef = REPLAY_ONLY ? recordedRef : liveRef

  // Live metrics for the impact panel. Skipped in replay builds -- there is no
  // server to poll, and a retry loop against a 404 would run for as long as the
  // page stays open.
  useEffect(() => {
    if (REPLAY_ONLY) return
    let alive = true
    let timer = null
    const poll = async () => {
      try {
        const r = await fetch('/api/twins')
        const d = await r.json()
        if (alive) setTwins(d)
      } catch {
        if (alive) setTwins(null)
      }
      if (alive) timer = setTimeout(poll, 2500)
    }
    poll()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !chrome) setChrome(true)
      if (e.key.toLowerCase() === 'h' &&
          !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')) {
        setChrome((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chrome])

  const isHome = tab === 'home'
  const isCity = tab === 'city'

  // The tab title follows what is actually on screen: Barcelona on Home, the
  // selected district under Try your city. Rewriting App.jsx for the 3D
  // restore dropped this effect, so the title sat on whatever index.html
  // shipped with regardless of the city being shown.
  useEffect(() => {
    if (isHome) { document.title = 'MainstreetAi · Barcelona'; return }
    // The reading tabs are not about a city, so they must not inherit whichever
    // district happened to be selected before.
    if (!isCity) {
      document.title = tab === 'research'
        ? 'MainstreetAi · Research' : 'MainstreetAi · Contact'
      return
    }
    let alive = true
    const base = REPLAY_ONLY ? './' : '/'
    fetch(`${base}districts.json`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        const hit = d.districts?.find((x) => x.key === district)
        document.title = hit ? `MainstreetAi · ${hit.label}` : 'MainstreetAi'
      })
      .catch(() => { /* a title is not worth failing the page over */ })
    return () => { alive = false }
  }, [district, isHome, isCity, tab])

  // Picking a district shows it in the pixel view, which lives on this tab. It
  // used to jump to Home, which now belongs to the 3D scene instead.
  const onSelectDistrict = useCallback((key) => setDistrict(key), [])

  // Home from another tab navigates. Home while ALREADY home flies the camera
  // back to the opening shot, because a control that does nothing when you are
  // stood on its destination is indistinguishable from a broken one -- which is
  // how it got reported. After panning across the city, "take me back" is the
  // thing people actually want from it.
  const onTab = useCallback((next) => {
    if (next === 'home' && tab === 'home' && map) {
      const p = PRESETS.eixample
      map.easeTo({
        center: p.center, zoom: p.zoom, pitch: p.pitch, bearing: p.bearing,
        duration: 900,
      })
    }
    setTab(next)
  }, [tab, map])

  return (
    <div className={`app ${chrome ? '' : 'bare'}`}>
      {/* The 3D hero stays mounted across tabs: re-initialising MapLibre means
          re-fetching tiles and rebuilding every three.js buffer, which is a
          visible stall on the hardware this targets. opacity hides it from
          sight, aria-hidden from a screen reader. */}
      <div className="scene-layer"
           aria-hidden={!isHome}
           style={{ opacity: isHome ? 1 : 0,
                    pointerEvents: isHome ? 'auto' : 'none' }}>
        <Scene
          onMapReady={onMapReady}
          onBasemapStatus={onBasemapStatus}
          frameRef={frameRef}
        />
        <Atmosphere map={map} />
      </div>

      {/* The pixel view, only under Try your city. Unlike the 3D scene this one
          is cheap to rebuild, and mounting it only when shown keeps a second
          animation loop off the Home tab. */}
      {isCity && (
        <div className="scene-layer pixel-layer">
          <Suspense fallback={null}>
          {/* Fixed-time by default, on purpose. This tab shows a district's
              baseline flow -- signals on a fixed programme, nothing adapting --
              and does not share the Home rail's AI switch. The comparison is
              Home's job; here the point is to see the city move at all. */}
          {REPLAY_ONLY
            ? <ReplayScene lighting={mode} district={district} twin="baseline"
                           onStats={setTwins} />
            : <PixelScene frameRef={frameRef} mode={mode} district={district}
                          liveDistrict={header?.district ?? null} />}
          </Suspense>
        </div>
      )}

      <Navbar
        tab={tab} onTab={onTab}
        mode={mode} onMode={setMode}
        chrome={chrome} onChrome={setChrome}
      />

      {isHome && (
        <>
          <aside className="rail">
            <ImpactPanel twins={REPLAY_ONLY ? recordedMeta?.stats : twins} />
            <AiToggle compact onFocusChange={setTwin} />
          </aside>
          {!REPLAY_ONLY && (
            <div className="masthead-live">
              <LiveCity />
              <span className="masthead-tag">
                {status === 'live' ? BASEMAP_LABEL[basemap]
                                   : `Simulation · ${status}`}
              </span>
            </div>
          )}
          {/* These read camera state off the MapLibre instance, so they belong
              to the 3D scene and only to it. */}
          <CameraControls map={map} />
          <Bezel map={map} header={header} />
          {!chrome && (
            <button className="bare-exit" onClick={() => setChrome(true)}>
              Show panels · Esc
            </button>
          )}
        </>
      )}

      {isCity && (
        <div className="page-layer city-layer">
          <Suspense fallback={null}>
            <TryCity current={district} onSelect={onSelectDistrict} />
          </Suspense>
        </div>
      )}

      {tab === 'research' && (
        <div className="page-layer">
          <Suspense fallback={<p className="page-loading">Loading…</p>}>
            <Research />
          </Suspense>
        </div>
      )}

      {tab === 'contact' && (
        <div className="page-layer">
          <Suspense fallback={<p className="page-loading">Loading…</p>}>
            <Contact />
          </Suspense>
        </div>
      )}
    </div>
  )
}
