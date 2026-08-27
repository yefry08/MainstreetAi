import { useCallback, useEffect, useState } from 'react'
import Navbar from './ui/Navbar'
import ImpactPanel from './ui/ImpactPanel'
import Contact from './ui/Contact'
import TryCity from './ui/TryCity'
import LiveCity from './ui/LiveCity'
import PixelScene from './pixel/PixelScene'
import ReplayScene from './pixel/ReplayScene'
import AiToggle from './pixel/AiToggle'
import { useSimSocket } from './data/useSimSocket'

/**
 * Single page: a full-bleed simulation with chrome over it, plus two content
 * tabs.
 *
 * TWO RUNTIMES, ONE UI
 * With a Python server the scene is live over a WebSocket. On a static host
 * there is no server, so it plays a recording instead. VITE_REPLAY_ONLY is set
 * at build time for the static bundles; everything above the scene is the same
 * in both, which is what keeps the deployed page from drifting away from the
 * one that gets developed.
 */
const REPLAY_ONLY = import.meta.env?.VITE_REPLAY_ONLY === '1'

export default function App() {
  const [tab, setTab] = useState('home')
  const [mode, setMode] = useState('night')
  const [chrome, setChrome] = useState(true)
  const [district, setDistrict] = useState('barcelona')
  const [twins, setTwins] = useState(null)
  const [twin, setTwin] = useState('ai')

  // Live metrics for the impact panel. Skipped entirely in replay builds --
  // there is no server to poll, and a retry loop against a 404 would run for
  // as long as the page is open.
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

  const { frameRef, header } = useSimSocket({ enabled: !REPLAY_ONLY })

  // Escape leaves the clean view without hunting for the button.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !chrome) setChrome(true)
      if (e.key.toLowerCase() === 'h' && tab === 'home' &&
          !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')) {
        setChrome((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chrome, tab])

  // The tab title said "Barcelona" whatever district was on screen, which is
  // the one label a viewer sees without looking at the page at all.
  useEffect(() => {
    let alive = true
    const base = import.meta.env?.VITE_REPLAY_ONLY === '1' ? './' : '/'
    fetch(`${base}districts.json`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        const hit = d.districts?.find((x) => x.key === district)
        document.title = hit ? `MainstreetAi · ${hit.label}` : 'MainstreetAi'
      })
      .catch(() => { /* the title is not worth failing the page over */ })
    return () => { alive = false }
  }, [district])

  const onSelectDistrict = useCallback((key) => {
    setDistrict(key)
    setTab('home')
  }, [])

  const showScene = tab === 'home'

  return (
    <div className={`app ${chrome ? '' : 'bare'}`}>
      {/* The scene stays mounted across tabs. Unmounting it would throw away a
          decoded 7.5 MB basemap and a warmed socket every time someone looks
          at the contact page. */}
      {/* opacity alone hides the scene from sight but not from a screen
          reader, which still reads out the replay disclosure while the user is
          on the contact page. aria-hidden takes it out of the tree; the layer
          stays mounted so the basemap is not decoded again on every tab
          change. */}
      <div className="scene-layer"
           aria-hidden={!showScene}
           style={{ opacity: showScene ? 1 : 0,
                    pointerEvents: showScene ? 'auto' : 'none' }}>
        {REPLAY_ONLY
          ? <ReplayScene lighting={mode} district={district} twin={twin}
                          onStats={setTwins} />
          : <PixelScene frameRef={frameRef} mode={mode} district={district}
                        liveDistrict={header?.district ?? null} />}
      </div>

      <Navbar
        tab={tab} onTab={setTab}
        mode={mode} onMode={setMode}
        chrome={chrome} onChrome={setChrome}
      />

      {tab === 'home' && (
        <>
          <aside className="rail">
            <ImpactPanel twins={twins} />
            <AiToggle compact onFocusChange={setTwin} />
          </aside>
          {!REPLAY_ONLY && <div className="masthead-live"><LiveCity /></div>}
          {!chrome && (
            <button className="bare-exit" onClick={() => setChrome(true)}>
              Show panels · Esc
            </button>
          )}
        </>
      )}

      {tab === 'city' && (
        <div className="page-layer">
          <TryCity current={district} onSelect={onSelectDistrict} />
        </div>
      )}

      {tab === 'contact' && (
        <div className="page-layer">
          <Contact />
        </div>
      )}
    </div>
  )
}
