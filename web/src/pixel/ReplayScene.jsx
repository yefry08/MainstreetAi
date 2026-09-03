import { useCallback, useEffect, useRef, useState } from 'react'
import { createRenderer } from './renderer.js'
import { loadImage } from './decodeImage.js'
import { hasTraffic as districtHasTraffic, replayDir, signalsPath, basemapPath }
  from './districtAssets.js'
import { openingView } from './framing.js'
import { loadReplay } from './replay.js'

/**
 * Static replay: the recorded simulation, playable with no server.
 *
 * This exists because GitHub Pages cannot run Python. The live app gets every
 * vehicle position from a WebSocket to a SUMO process, so a Pages deploy of it
 * would render a basemap and nothing else. A recording is the honest
 * alternative -- the real simulation, really run, played back.
 *
 * What it genuinely cannot do is respond. The toggle switches between two
 * PRE-RECORDED twins rather than re-deciding anything, and the page says so
 * rather than letting a viewer assume the AI is thinking while they watch.
 */
export default function ReplayScene({ lighting = 'night', district = 'barcelona', twin = 'ai', onStats }) {
  // `mode` in this component already means which TWIN is on screen. The
  // lighting axis is separate and is named separately -- reusing `mode` for
  // both silently shadowed the twin selector.
  const lightRef = useRef(lighting)
  // A district animates only if it has both a network and a recording; the
  // rest are basemaps, and borrowing another city's traffic for them would be
  // a picture that looks right and is not.
  const hasTraffic = districtHasTraffic(district)
  const canvasRef = useRef(null)
  const rendererRef = useRef(null)
  const replayRef = useRef(null)
  const modeRef = useRef(twin)

  const [status, setStatus] = useState('loading recording…')
  const [stats, setStats] = useState(null)
  const [meta, setMeta] = useState(null)

  // Playback speed of the RECORDING. This is a multiplier on how fast frames
  // are advanced, and nothing else: it does not touch which twin plays, does
  // not ask a controller to do anything, and is deliberately kept apart from
  // the AI switch on the Home rail so the two are never confused. 1x plays at
  // the rate the simulation was recorded; 2x advances frames twice as fast.
  const [rate, setRate] = useState(1)
  const rateRef = useRef(1)
  useEffect(() => { rateRef.current = rate }, [rate])
  useEffect(() => { lightRef.current = lighting }, [lighting])

  // The sidebar switch owns this now, so the scene follows the prop rather
  // than holding a second copy of the same state that could disagree with it.
  useEffect(() => { modeRef.current = twin }, [twin])

  const choose = useCallback((next) => { modeRef.current = next }, [])

  useEffect(() => {
    let alive = true
    let raf = 0

    ;(async () => {
      try {
        setStatus(hasTraffic ? 'loading recording…' : 'loading map…')
        const replay = hasTraffic ? await loadReplay(replayDir(district)) : null
        if (!alive) return
        replayRef.current = replay

        const base = await (await fetch(basemapPath(district))).json()
        setStatus(`decoding ${base.width_px}×${base.height_px} basemap…`)
        const { img, decodeTimedOut } = await loadImage(`./data/${base.png}`)
        if (decodeTimedOut) console.warn('[replay] pre-decode timed out; drawing anyway')
        if (!alive) return

        const sigRes = hasTraffic ? await fetch(signalsPath(district))
                                  : { ok: false }
        const signals = sigRes.ok ? await sigRes.json() : null

        const r = createRenderer(canvasRef.current, {
          basemapMeta: base, basemapImage: img, signals,
        })
        rendererRef.current = r
        setMeta(replay ? { ...replay.stats, recordedAt: replay.recordedAt } : null)
        onStats?.(replay ? replay.stats : null)

        // Open close, on the busiest part of the network. See framing.js.
        const kx = base.lonlat_to_px.kx
        const ky = base.lonlat_to_px.ky
        const toPx = (lon, lat) => {
          const b = [1, lon, lat, lon * lon, lon * lat, lat * lat]
          return [kx.reduce((s, k, i) => s + k * b[i], 0),
                  ky.reduce((s, k, i) => s + k * b[i], 0)]
        }
        const c = canvasRef.current
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        r.setView(openingView(base, signals, c.clientWidth * dpr,
                              c.clientHeight * dpr, toPx))

        setStatus(hasTraffic ? null : 'map only — no traffic model for this district yet')

        // Play at the rate it was recorded, so motion matches the simulation
        // rather than the display. The renderer dead-reckons between frames,
        // which is what keeps it smooth at 60 Hz from a 4 Hz recording.
        const period = 1000 / (replay?.hz || 4)
        let last = performance.now()
        let idx = 0
        let lastStats = 0

        const tick = () => {
          if (!alive) return
          const now = performance.now()
          // Dividing the period, not multiplying the index: at 2x a frame is
          // advanced every 125 ms instead of 250, so dead-reckoning between
          // frames stays smooth rather than skipping every other one.
          if (now - last >= period / rateRef.current) {
            last = now
            idx += 1
            const f = replay?.frame(modeRef.current, idx)
            if (f) r.applyFrame(f)
          }
          const s = r.draw(lightRef.current)
          if (now - lastStats > 500) { lastStats = now; setStats(s) }
          raf = requestAnimationFrame(tick)
        }
        // Was hard-coded to 'ai', so a scene asked to open on the fixed-time
        // twin drew one AI frame first. Follow the twin actually requested.
        const f0 = replay?.frame(modeRef.current, 0)
        if (f0) r.applyFrame(f0)
        raf = requestAnimationFrame(tick)

        window.__replay = {
          renderer: r, replay,
          forceDraw: (n = 1) => {
            let s = null
            for (let i = 0; i < n; i++) {
              const f = replay?.frame(modeRef.current, ++idx)
              if (f) r.applyFrame(f)
              s = r.draw(lightRef.current)
            }
            return s
          },
          setMode: choose,
          setRate: (n) => { rateRef.current = n; setRate(n) },
          setView: (v) => r.setView(v),
        }
      } catch (err) {
        if (alive) setStatus(`failed: ${err.message}`)
      }
    })()

    return () => { alive = false; if (raf) cancelAnimationFrame(raf) }
  }, [choose, district, hasTraffic, onStats])

  // Drag to pan, wheel to zoom.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let drag = false, lx = 0, ly = 0
    const dpr = () => Math.min(window.devicePixelRatio || 1, 2)
    const down = (e) => { drag = true; lx = e.clientX; ly = e.clientY }
    const up = () => { drag = false }
    const move = (e) => {
      const r = rendererRef.current
      if (!drag || !r) return
      r.setView({
        x: r.view.x - ((e.clientX - lx) * dpr()) / r.view.scale,
        y: r.view.y - ((e.clientY - ly) * dpr()) / r.view.scale,
      })
      lx = e.clientX; ly = e.clientY
    }
    const wheel = (e) => {
      const r = rendererRef.current
      if (!r) return
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mx = (e.clientX - rect.left) * dpr()
      const my = (e.clientY - rect.top) * dpr()
      const old = r.view.scale
      const next = Math.max(0.05, Math.min(8, old * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
      r.setView({ x: r.view.x + mx / old - mx / next,
                  y: r.view.y + my / old - my / next, scale: next })
    }
    canvas.addEventListener('mousedown', down)
    window.addEventListener('mouseup', up)
    window.addEventListener('mousemove', move)
    canvas.addEventListener('wheel', wheel, { passive: false })
    return () => {
      canvas.removeEventListener('mousedown', down)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('mousemove', move)
      canvas.removeEventListener('wheel', wheel)
    }
  }, [])

  return (
    <div className="pixel-scene">
      <canvas ref={canvasRef} className="pixel-canvas" />
      {status && <div className="pixel-status">{status}</div>}
      {stats && (
        <div className="pixel-stats">{stats.drawn}/{stats.vehicles} veh · {stats.fps} fps</div>
      )}

      {/* The twin switch and the numbers moved to the sidebar. Two switches
          for one piece of state can disagree with each other, and the second
          copy of the stats had nothing the first did not. What stays is the
          disclosure, because it has to be next to the thing it qualifies. */}
      {/* The speed control is on its own, top-right, with the AI switch
          nowhere on this tab. Same panel, adjacent buttons, and someone would
          read "2x" as "AI on". */}
      {hasTraffic && !status && (
        <div className="replay-speed glass" role="group" aria-label="Playback speed">
          <span className="replay-speed-cap">Playback speed · not the AI switch</span>
          <button
            className={`replay-speed-btn ${rate !== 1 ? 'on' : ''}`}
            onClick={() => setRate((v) => (v === 1 ? 2 : 1))}
            aria-pressed={rate !== 1}
            title={rate === 1 ? 'Play the recording at twice the recorded rate'
                              : 'Back to the recorded rate'}
          >
            {rate === 1 ? 'See it flow faster · 2×' : 'Back to normal speed · 1×'}
          </button>
        </div>
      )}

      <div className="replay-note glass">
        {twin === 'baseline'
          ? <><b>Fixed-time signals, recorded.</b> Lights cycle on a fixed
              programme; nothing adapts. This is the baseline the AI twin is
              measured against — the comparison lives on the Home tab.</>
          : <><b>Recording, not live.</b> The adaptive twin, played back; nothing
              is being decided while you watch.</>}
        {meta?.recordedAt ? ` Recorded ${meta.recordedAt}.` : ''}
      </div>
    </div>
  )
}
