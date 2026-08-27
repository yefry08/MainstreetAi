import { useCallback, useEffect, useRef, useState } from 'react'
import { createRenderer } from './renderer.js'
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
export default function ReplayScene() {
  const canvasRef = useRef(null)
  const rendererRef = useRef(null)
  const replayRef = useRef(null)
  const modeRef = useRef('ai')

  const [status, setStatus] = useState('loading recording…')
  const [mode, setMode] = useState('ai')
  const [stats, setStats] = useState(null)
  const [meta, setMeta] = useState(null)

  const choose = useCallback((next) => {
    modeRef.current = next
    setMode(next)
  }, [])

  useEffect(() => {
    let alive = true
    let raf = 0

    ;(async () => {
      try {
        setStatus('loading recording…')
        const replay = await loadReplay('./replay')
        if (!alive) return
        replayRef.current = replay

        const base = await (await fetch('./data/basemap_barcelona.json')).json()
        setStatus(`decoding ${base.width_px}×${base.height_px} basemap…`)
        const img = new Image()
        img.decoding = 'async'
        await new Promise((res, rej) => {
          img.onload = res
          img.onerror = () => rej(new Error('basemap failed to load'))
          img.src = `./data/${base.png}`
        })
        if (img.decode) { try { await img.decode() } catch { /* older browsers */ } }
        if (!alive) return

        const sigRes = await fetch('./data/signal_approaches.geojson')
        const signals = sigRes.ok ? await sigRes.json() : null

        const r = createRenderer(canvasRef.current, {
          basemapMeta: base, basemapImage: img, signals,
        })
        rendererRef.current = r
        setMeta({ ...replay.stats, recordedAt: replay.recordedAt })

        // Frame the simulated extent, not the square render: its corners lie
        // outside the simulation and would show city with no traffic in it.
        const kx = base.lonlat_to_px.kx
        const ky = base.lonlat_to_px.ky
        const toPx = (lon, lat) => {
          const b = [1, lon, lat, lon * lon, lon * lat, lat * lat]
          return [kx.reduce((s, k, i) => s + k * b[i], 0),
                  ky.reduce((s, k, i) => s + k * b[i], 0)]
        }
        const ext = base.sim_extent
        const [x0, y1] = toPx(ext[0], ext[1])
        const [x1, y0] = toPx(ext[2], ext[3])
        const c = canvasRef.current
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const scale = Math.min((c.clientWidth * dpr) / (x1 - x0),
                               (c.clientHeight * dpr) / (y1 - y0))
        r.setView({ x: x0, y: y0, scale })

        setStatus(null)

        // Play at the rate it was recorded, so motion matches the simulation
        // rather than the display. The renderer dead-reckons between frames,
        // which is what keeps it smooth at 60 Hz from a 4 Hz recording.
        const period = 1000 / replay.hz
        let last = performance.now()
        let idx = 0
        let lastStats = 0

        const tick = () => {
          if (!alive) return
          const now = performance.now()
          if (now - last >= period) {
            last = now
            idx += 1
            const f = replay.frame(modeRef.current, idx)
            if (f) r.applyFrame(f)
          }
          const s = r.draw(1)
          if (now - lastStats > 500) { lastStats = now; setStats(s) }
          raf = requestAnimationFrame(tick)
        }
        const f0 = replay.frame('ai', 0)
        if (f0) r.applyFrame(f0)
        raf = requestAnimationFrame(tick)

        window.__replay = {
          renderer: r, replay,
          forceDraw: (n = 1) => {
            let s = null
            for (let i = 0; i < n; i++) {
              const f = replay.frame(modeRef.current, ++idx)
              if (f) r.applyFrame(f)
              s = r.draw(1)
            }
            return s
          },
          setMode: choose,
          setView: (v) => r.setView(v),
        }
      } catch (err) {
        if (alive) setStatus(`failed: ${err.message}`)
      }
    })()

    return () => { alive = false; if (raf) cancelAnimationFrame(raf) }
  }, [choose])

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

  const pct = (a, b, up) => {
    if (a == null || b == null || !b) return null
    const d = ((a - b) / Math.abs(b)) * 100
    return { d, good: up ? d > 0 : d < 0 }
  }
  const A = meta?.ai
  const B = meta?.baseline
  const rows = [
    ['Network speed', pct(A?.avg_speed_kmh, B?.avg_speed_kmh, true), B?.avg_speed_kmh, A?.avg_speed_kmh],
    ['Bus speed', pct(A?.bus_avg_speed_kmh, B?.bus_avg_speed_kmh, true), B?.bus_avg_speed_kmh, A?.bus_avg_speed_kmh],
    ['Time lost stopped', pct(A?.stopped_veh_hours, B?.stopped_veh_hours, false), B?.stopped_veh_hours, A?.stopped_veh_hours],
  ]

  return (
    <div className="pixel-scene">
      <canvas ref={canvasRef} className="pixel-canvas" />
      {status && <div className="pixel-status">{status}</div>}
      {stats && (
        <div className="pixel-stats">{stats.drawn}/{stats.vehicles} veh · {stats.fps} fps</div>
      )}

      <div className="ai-toggle glass">
        <div className="ai-switch">
          {['baseline', 'ai'].map((k) => (
            <button key={k} className={`ai-btn ${mode === k ? 'on' : ''}`}
                    onClick={() => choose(k)}>
              {k === 'ai' ? 'AI-adaptive' : 'Fixed-time'}
            </button>
          ))}
        </div>
        <div className="ai-note">
          <b>Recording, not live.</b> Both twins were run on identical demand and
          captured; this switches between the two recordings. The live version
          needs a Python server running SUMO, which static hosting cannot do.
        </div>
        {meta && (
          <div className="ai-stats">
            {rows.map(([label, d, b, a]) => (
              <div className="ai-row" key={label}>
                <span className="ai-label">{label}</span>
                <span className="ai-pair">
                  <b className="base">{b == null ? '–' : b.toFixed(1)}</b>
                  <i>→</i>
                  <b className="ai">{a == null ? '–' : a.toFixed(1)}</b>
                </span>
                <span className={`ai-delta ${d ? (d.good ? 'good' : 'bad') : ''}`}>
                  {d ? `${d.d > 0 ? '+' : ''}${d.d.toFixed(1)}%` : '–'}
                </span>
              </div>
            ))}
            <div className="ai-drift">recorded {meta.recordedAt}</div>
          </div>
        )}
      </div>
    </div>
  )
}
