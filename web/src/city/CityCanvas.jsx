import { useEffect, useRef } from 'react'

/**
 * Draws the running simulation: real streets, live vehicles, live signals.
 *
 * 2D canvas rather than three.js on purpose. The Home hero already carries
 * three.js and MapLibre, and this view has to start fast on a machine that has
 * just spent twenty seconds on an Overpass query. A canvas draws two thousand
 * street segments and a few hundred vehicles comfortably, and it needs no
 * basemap tiles, no styles and no second WebGL context.
 *
 * The camera is fitted to the graph's own extent, so any city lands framed
 * regardless of how big its extract turned out.
 */
export default function CityCanvas({ graph, world, palette, running }) {
  const ref = useRef(null)
  const worldRef = useRef(world)
  const paletteRef = useRef(palette)
  useEffect(() => { worldRef.current = world }, [world])
  useEffect(() => { paletteRef.current = palette }, [palette])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !graph) return
    const ctx = canvas.getContext('2d')
    let raf = 0
    let alive = true

    // Fit once: the graph does not move, so the transform is computed here and
    // not per frame.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const e of graph.edges) {
      for (const [x, y] of e.pts) {
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
      }
    }

    const draw = () => {
      if (!alive) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.round(canvas.clientWidth * dpr)
      const h = Math.round(canvas.clientHeight * dpr)
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }

      const p = paletteRef.current
      const pad = 18 * dpr
      const scale = Math.min((w - pad * 2) / (maxX - minX || 1),
                             (h - pad * 2) / (maxY - minY || 1))
      // y is flipped: north is up on screen, and OSM metres grow northward.
      const tx = (x) => pad + (x - minX) * scale
      const ty = (y) => h - pad - (y - minY) * scale

      ctx.fillStyle = p.ground
      ctx.fillRect(0, 0, w, h)

      // --- streets, wider for the bigger roads ---------------------------
      ctx.strokeStyle = p.roads
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const e of graph.edges) {
        ctx.lineWidth = Math.max(1, (e.lanes * 1.6 + 1.2) * dpr * 0.8)
        ctx.beginPath()
        ctx.moveTo(tx(e.pts[0][0]), ty(e.pts[0][1]))
        for (let i = 1; i < e.pts.length; i++) ctx.lineTo(tx(e.pts[i][0]), ty(e.pts[i][1]))
        ctx.stroke()
      }

      const wd = worldRef.current
      if (wd) {
        // --- signals: the state a driver would actually see --------------
        for (const s of wd.signals) {
          const x = tx(s.x), y = ty(s.y)
          ctx.fillStyle = s.state === 0 ? '#3fb34f' : '#f2b134'
          ctx.beginPath()
          ctx.arc(x, y, 2.4 * dpr, 0, Math.PI * 2)
          ctx.fill()
        }

        // --- vehicles, positioned along their edge's polyline -------------
        for (const v of wd.fleet) {
          const e = graph.edges[v.edge]
          if (!e) continue
          const along = v.fwd ? v.pos : e.len - v.pos
          const [x, y] = pointOnEdge(e, along)
          // Stopped traffic is the accent colour: it is the thing the whole
          // demo is about, so it should be the thing the eye lands on.
          ctx.fillStyle = v.speed < 0.2 ? p.accent
            : v.kind === 1 ? '#4a7fb0' : v.kind === 2 ? '#5f9f5c' : p.buildings
          const r = (v.kind === 1 ? 2.6 : 2.0) * dpr
          ctx.beginPath()
          ctx.arc(tx(x), ty(y), r, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => { alive = false; cancelAnimationFrame(raf) }
  }, [graph])

  return <canvas ref={ref} className={`city-canvas ${running ? '' : 'paused'}`} />
}

/** Walk the polyline to find the point `d` metres from its start. */
function pointOnEdge(e, d) {
  let acc = 0
  for (let i = 1; i < e.pts.length; i++) {
    const [x0, y0] = e.pts[i - 1]
    const [x1, y1] = e.pts[i]
    const seg = Math.hypot(x1 - x0, y1 - y0)
    if (acc + seg >= d) {
      const f = seg > 0 ? (d - acc) / seg : 0
      return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]
    }
    acc += seg
  }
  return e.pts[e.pts.length - 1]
}
