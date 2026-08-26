/**
 * 2D canvas renderer: pixel-art traffic over the illustrated base map.
 *
 * Replaces the three.js scene. Everything here is 2D and CPU-cheap by design;
 * the target is an Intel N100 with integrated graphics.
 *
 * LAYERS, back to front:
 *   basemap    one pre-rendered image, blitted per frame
 *   glow       headlight bloom, additive, on its own low-res buffer
 *   vehicles   pre-baked pixel sprites, one drawImage each
 *   signals    per-approach lamps
 *
 * WHY THE GLOW HAS ITS OWN BUFFER
 * A believable bloom needs a blur. Blurring the main canvas would blur the
 * map. Running ctx.filter='blur()' per vehicle is far too slow. So the glow is
 * drawn as soft radial sprites into a buffer at a fraction of the resolution
 * and then stretched over the scene with 'lighter' compositing: the upscale IS
 * the blur, and it costs one composite for the whole fleet.
 *
 * MOTION IS INTERPOLATED, NOT SNAPPED
 * Simulation frames arrive at a few hertz; the display runs at 60. Vehicles
 * therefore advance along their own heading at their own reported speed
 * between frames, exactly as the three.js version did -- and for the same
 * reason: the wire carries no vehicle ids, so positions cannot be matched
 * frame-to-frame and cannot be interpolated between two known states. This is
 * dead reckoning, and the turn rate is carried per-vehicle on the wire because
 * a slot holds the same vehicle only ~36% of the time.
 */

import { createTransform, headingToCanvasRadians } from './transform.js'
import { buildSpriteSheet, frameIndex, spriteKey, KIND } from './sprites.js'

const STRIDE = 6            // lon, lat, angle, kind, speed, turn
const STOPPED_MS = 0.6      // below this a vehicle reads as halted
const GLOW_DIV = 4          // glow buffer is 1/N of the scene, upscale = blur

const SIGNAL_COLOUR = ['#f0454f', '#fbbf24', '#4ade80']  // red, amber, green

export function createRenderer(canvas, { basemapMeta, basemapImage, signals }) {
  const ctx = canvas.getContext('2d', { alpha: false })
  const tf = createTransform(basemapMeta)
  const sheet = buildSpriteSheet(2)

  const glow = document.createElement('canvas')
  const gctx = glow.getContext('2d')

  // A single soft radial dot, stretched per headlight. Building it once and
  // scaling is far cheaper than creating a gradient per vehicle per frame.
  const dot = document.createElement('canvas')
  dot.width = dot.height = 64
  {
    const d = dot.getContext('2d')
    const g = d.createRadialGradient(32, 32, 0, 32, 32, 32)
    g.addColorStop(0, 'rgba(255,240,200,0.95)')
    g.addColorStop(0.35, 'rgba(255,214,140,0.45)')
    g.addColorStop(1, 'rgba(255,200,120,0)')
    d.fillStyle = g
    d.fillRect(0, 0, 64, 64)
  }

  // Signal lamp positions, projected once. They never move.
  const sig = { x: new Float32Array(0), y: new Float32Array(0), n: 0 }
  if (signals?.features?.length && tf.ok) {
    const n = signals.features.length
    sig.x = new Float32Array(n)
    sig.y = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const c = signals.features[i].geometry.coordinates
      const p = tf.toPx(c[0], c[1], { x: 0, y: 0 })
      sig.x[i] = p.x
      sig.y[i] = p.y
    }
    sig.n = n
  }

  // View: which part of the basemap is on screen.
  let view = { x: 0, y: 0, scale: 1 }

  // Latest simulation frame, plus when it landed.
  let veh = null
  let vehCount = 0
  let tickAt = 0
  let tickInterval = 0.25
  let sigState = null
  let stats = { vehicles: 0, drawn: 0, fps: 0 }

  const px = { x: 0, y: 0 }

  function applyFrame(frame) {
    const v = frame?.vehicles
    if (!v) return
    veh = v
    vehCount = (v.length / STRIDE) | 0
    const now = performance.now()
    if (tickAt) {
      const gap = (now - tickAt) / 1000
      if (gap > 0.01 && gap < 10) tickInterval = tickInterval * 0.7 + gap * 0.3
    }
    tickAt = now
    sigState = frame.signals ?? sigState
  }

  function setView(next) {
    view = { ...view, ...next }
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.round(canvas.clientWidth * dpr)
    const h = Math.round(canvas.clientHeight * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      glow.width = Math.max(1, Math.round(w / GLOW_DIV))
      glow.height = Math.max(1, Math.round(h / GLOW_DIV))
    }
    return { w, h, dpr }
  }

  let lastDraw = performance.now()

  function draw(nightness = 1) {
    const { w, h } = resize()
    const s = view.scale
    let drawn = 0

    ctx.imageSmoothingEnabled = false
    ctx.setTransform(1, 0, 0, 1, 0, 0)

    if (basemapImage) {
      ctx.drawImage(
        basemapImage,
        view.x, view.y, w / s, h / s,
        0, 0, w, h,
      )
    } else {
      ctx.fillStyle = '#0b0e15'
      ctx.fillRect(0, 0, w, h)
    }

    if (!tf.ok || !veh) {
      // Say so rather than drawing a plausible-looking empty city.
      ctx.fillStyle = 'rgba(240,69,79,0.9)'
      ctx.font = '14px monospace'
      ctx.fillText(tf.ok ? 'waiting for simulation frame'
                         : 'basemap transform missing - refusing to draw', 16, 24)
      return stats
    }

    // How far to extrapolate. Bounded so a dead socket coasts to a halt
    // instead of flinging vehicles off the map.
    const since = (performance.now() - tickAt) / 1000
    const window_s = Math.min(6.0, tickInterval * 1.35)
    const dt = Math.min(window_s, since)
    const turnT = Math.min(1, since / Math.max(0.05, tickInterval))

    gctx.setTransform(1, 0, 0, 1, 0, 0)
    gctx.clearRect(0, 0, glow.width, glow.height)
    const gs = 1 / GLOW_DIV

    for (let i = 0; i < vehCount; i++) {
      const o = i * STRIDE
      const lon = veh[o]
      const lat = veh[o + 1]
      const angDeg = veh[o + 2]
      const kind = veh[o + 3] | 0
      const speed = veh[o + 4]
      const turn = veh[o + 5]

      tf.toPx(lon, lat, px)

      // Dead reckoning in PIXEL space. Metres-per-pixel is known and uniform,
      // so advancing here avoids a second projection per vehicle per frame.
      const headingNow = angDeg + turn * turnT
      const rad = headingToCanvasRadians(headingNow)
      const advancePx = (speed * dt) / tf.metresPerPixel
      const cx = px.x + Math.cos(rad) * advancePx
      const cy = px.y + Math.sin(rad) * advancePx

      const sx = (cx - view.x) * s
      const sy = (cy - view.y) * s
      if (sx < -32 || sy < -32 || sx > w + 32 || sy > h + 32) continue

      const stopped = speed < STOPPED_MS
      const key = spriteKey(kind, stopped)
      const entry = sheet[key]
      if (!entry) continue
      const f = entry.frames[frameIndex(rad + Math.PI / 2)]
      const half = (entry.size * s) / 2
      ctx.drawImage(f, sx - half, sy - half, entry.size * s, entry.size * s)
      drawn++

      // Headlights: only while moving, and only for things that have them.
      if (!stopped && kind !== KIND.bike && nightness > 0.05) {
        const ahead = (kind === KIND.bus || kind === KIND.truck ? 9 : 5) * s
        const hx = (sx + Math.cos(rad) * ahead) * gs
        const hy = (sy + Math.sin(rad) * ahead) * gs
        const r = (kind === KIND.bus || kind === KIND.truck ? 13 : 9) * s * gs
        gctx.globalAlpha = 0.5 * nightness
        gctx.drawImage(dot, hx - r, hy - r, r * 2, r * 2)
      }
    }

    // One composite for the whole fleet's glow. The upscale is the blur.
    if (nightness > 0.05) {
      ctx.globalCompositeOperation = 'lighter'
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(glow, 0, 0, w, h)
      ctx.globalCompositeOperation = 'source-over'
      ctx.imageSmoothingEnabled = false
    }

    // Signals last: they must read on top of traffic, not under it.
    if (sigState && sig.n) {
      const r = Math.max(1.5, 2.2 * s)
      const n = Math.min(sig.n, sigState.length)
      for (let i = 0; i < n; i++) {
        const sx = (sig.x[i] - view.x) * s
        const sy = (sig.y[i] - view.y) * s
        if (sx < 0 || sy < 0 || sx > w || sy > h) continue
        ctx.fillStyle = SIGNAL_COLOUR[sigState[i]] ?? SIGNAL_COLOUR[0]
        ctx.fillRect(sx - r, sy - r, r * 2, r * 2)
      }
    }

    const now = performance.now()
    stats = {
      vehicles: vehCount,
      drawn,
      fps: Math.round(1000 / Math.max(1, now - lastDraw)),
    }
    lastDraw = now
    return stats
  }

  return {
    applyFrame,
    setView,
    draw,
    get view() { return view },
    stats: () => stats,
    transformOk: tf.ok,
    basemapSize: { w: tf.width, h: tf.height },
  }
}
