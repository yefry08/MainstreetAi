import { useEffect, useRef, useState } from 'react'
import { createRenderer } from './renderer.js'
import { loadImage } from './decodeImage.js'
import { hasTraffic as districtHasTraffic, signalsPath } from './districtAssets.js'
import { openingView } from './framing.js'

/**
 * Host for the 2D pixel-art scene.
 *
 * Owns three things the renderer deliberately does not: loading its assets,
 * the animation loop, and the camera. The renderer is a pure draw function so
 * it can be tested without a DOM.
 *
 * ASSET LOADING IS THE SLOW PART, AND IT IS HONEST ABOUT IT
 * The basemap is a 24 MB PNG. Decoded it is ~100 MB of RGBA. That is a real
 * pause on the Intel N100 this restructure targets, so the status is shown
 * rather than hidden behind a blank canvas -- a silent black screen during a
 * demo is indistinguishable from a crash.
 */
export default function PixelScene({ frameRef, mode = 'night', district = 'barcelona',
                                     liveDistrict = null }) {
  const canvasRef = useRef(null)
  const rendererRef = useRef(null)
  // Two separate ways the traffic on the wire can fail to belong to the map on
  // screen. The first is a district with no network at all. The second is a
  // server simulating somewhere else entirely -- it now says which city it is
  // running, and if that disagrees with what is being drawn the vehicles are
  // dropped rather than scattered over the wrong streets.
  const mismatched = liveDistrict != null && liveDistrict !== district
  const hasTraffic = districtHasTraffic(district) && !mismatched
  const [status, setStatus] = useState('loading basemap…')
  const [stats, setStats] = useState(null)
  // The rAF loop closes over its effect scope, so the live mode is read
  // through a ref -- putting `mode` in the dependency list would tear the
  // renderer down and re-decode the basemap on every lighting change.
  const modeRef = useRef(mode)
  useEffect(() => { modeRef.current = mode }, [mode])

  useEffect(() => {
    let alive = true
    let raf = 0

    const load = async () => {
      try {
        const [metaRes, sigRes] = await Promise.all([
          fetch(`/data/basemap_${district}.json`),
          hasTraffic ? fetch(signalsPath(district, '/'))
                     : Promise.resolve({ ok: false }),
        ])
        if (!metaRes.ok) throw new Error(`basemap sidecar ${metaRes.status}`)
        const meta = await metaRes.json()
        const signals = sigRes.ok ? await sigRes.json() : null

        if (!meta.lonlat_to_px) {
          throw new Error(
            'sidecar has no lonlat_to_px — run: python sim/basemap/build_basemap.py --patch')
        }

        setStatus(`decoding ${meta.width_px}×${meta.height_px} basemap…`)
        const { img, decodeTimedOut } = await loadImage(`/data/${meta.png}`)
        if (decodeTimedOut) {
          console.warn('[pixel] pre-decode timed out; drawing anyway')
        }
        if (!alive) return

        const canvas = canvasRef.current
        if (!canvas) return
        const r = createRenderer(canvas, {
          basemapMeta: meta,
          basemapImage: img,
          signals,
        })
        rendererRef.current = r

        // Open close, on the busiest part of the network. See framing.js --
        // framing the whole extent put a car at 3 x 5 pixels.
        if (meta.sim_extent && r.transformOk) {
          const kx = meta.lonlat_to_px.kx
          const ky = meta.lonlat_to_px.ky
          const toPx = (lon, lat) => {
            const b = [1, lon, lat, lon * lon, lon * lat, lat * lat]
            return [
              kx.reduce((s, k, i) => s + k * b[i], 0),
              ky.reduce((s, k, i) => s + k * b[i], 0),
            ]
          }
          const dpr = Math.min(window.devicePixelRatio || 1, 2)
          const dw = (canvas.clientWidth || 1200) * dpr
          const dh = (canvas.clientHeight || 800) * dpr
          r.setView(openingView(meta, signals, dw, dh, toPx))
        }

        setStatus(
          hasTraffic ? null
            : mismatched
              ? `map only — the live server is simulating ${liveDistrict}, not this district`
              : 'map only — no traffic model for this district yet')

        const step = () => {
          const f = hasTraffic ? frameRef?.current : null
          if (f) r.applyFrame(f)
          return r.draw(modeRef.current)
        }

        const tick = () => {
          if (!alive) return
          setStatsThrottled(step())
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)

        // Debug handle, mirroring window.__mst for the three.js scene.
        // requestAnimationFrame is throttled to zero in a backgrounded or
        // non-compositing tab, which stalls the loop and makes a perfectly
        // healthy renderer look dead. This advances it by hand so the scene
        // stays inspectable when the browser will not schedule frames.
        window.__pixel = {
          renderer: r,
          meta,
          forceDraw: (n = 1) => {
            let s = null
            for (let i = 0; i < n; i++) s = step()
            return s
          },
          setView: (v) => r.setView(v),
          stats: () => r.stats(),
        }
      } catch (err) {
        if (alive) setStatus(`failed: ${err.message}`)
      }
    }

    // Reporting stats into React state every frame would re-render the tree at
    // 60 Hz for a debug readout.
    let lastStats = 0
    const setStatsThrottled = (s) => {
      const now = performance.now()
      if (now - lastStats > 500) {
        lastStats = now
        setStats(s)
      }
    }

    load()
    return () => {
      alive = false
      if (raf) cancelAnimationFrame(raf)
    }
  }, [frameRef, district, hasTraffic, mismatched, liveDistrict])

  // ---- camera: drag to pan, wheel to zoom ------------------------------
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let dragging = false
    let lastX = 0
    let lastY = 0

    const down = (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY }
    const up = () => { dragging = false }
    const move = (e) => {
      const r = rendererRef.current
      if (!dragging || !r) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const s = r.view.scale
      r.setView({
        x: r.view.x - ((e.clientX - lastX) * dpr) / s,
        y: r.view.y - ((e.clientY - lastY) * dpr) / s,
      })
      lastX = e.clientX
      lastY = e.clientY
    }
    const wheel = (e) => {
      const r = rendererRef.current
      if (!r) return
      e.preventDefault()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const rect = canvas.getBoundingClientRect()
      const mx = (e.clientX - rect.left) * dpr
      const my = (e.clientY - rect.top) * dpr
      const old = r.view.scale
      const next = Math.max(0.05, Math.min(8, old * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
      // Keep the point under the cursor fixed while zooming.
      r.setView({
        x: r.view.x + mx / old - mx / next,
        y: r.view.y + my / old - my / next,
        scale: next,
      })
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
        <div className="pixel-stats">
          {stats.drawn}/{stats.vehicles} veh · {stats.fps} fps
        </div>
      )}
    </div>
  )
}
