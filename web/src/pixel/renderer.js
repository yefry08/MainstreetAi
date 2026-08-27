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
import { applyTint, glowFor, signalBoostFor } from './lighting.js'

const STRIDE = 6            // lon, lat, angle, kind, speed, turn
const STOPPED_MS = 0.6      // below this a vehicle reads as halted
const GLOW_DIV = 4          // glow buffer is 1/N of the scene, upscale = blur

// Smallest a car may render, in screen pixels along its length.
//
// The three.js version learned this the hard way: at the default camera a
// true-to-scale car was 1.3 px long and the streets looked completely empty
// while several hundred vehicles were being drawn every frame. The same
// arithmetic applies here -- at 2 m/px and a city-wide view a 4.3 m car is
// about 2 px -- so the same fix applies, and vehicles are exaggerated as the
// view pulls back.
//
// The exaggeration is UNIFORM. The 3D version originally held width back with
// a separate cap and drew 30 m x 4.4 m slivers at wide zoom, an aspect ratio
// of 6.8:1 against a real car's 2.32:1. Scaling every axis together cannot do
// that, and because the floor is expressed as a LENGTH the width follows from
// the vehicle's own proportions.
const MIN_CAR_PX = 9
const CAR_LEN_ART = 10      // car sprite length in art pixels, see sprites.js
const SPRITE_SCALE = 2      // art pixels -> sprite pixels, see buildSpriteSheet
const MAX_EXAGGERATION = 6

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

  function draw(mode = 'night') {
    // Lighting is a composite pass, not a light source: the tint lands between
    // the basemap and the vehicles so sprites keep their own colours, and the
    // mode scales the headlight bloom. See lighting.js for why re-lighting the
    // map itself is not on the table.
    const nightness = glowFor(mode)
    const { w, h } = resize()
    const s = view.scale
    let drawn = 0
    let skipped = 0

    ctx.imageSmoothingEnabled = false
    ctx.setTransform(1, 0, 0, 1, 0, 0)

    // Always paint the ground first. The basemap is square while the simulated
    // extent is not, and the canvas aspect matches neither, so a fitted view
    // very often reads past the edge of the image -- where drawImage draws
    // nothing at all and leaves whatever was in the buffer. That showed up as a
    // hard black band down one side, which looks like a broken renderer rather
    // than like the edge of the map.
    // White because that is what the PNG's own margin is -- sampled from its
    // corners rather than guessed. A first attempt used the pale green apron
    // colour, which is prettymaps' perimeter fill drawn INSIDE the image, and
    // that left a visible vertical seam where the two met.
    ctx.fillStyle = basemapMeta?.margin_colour ?? '#ffffff'
    ctx.fillRect(0, 0, w, h)

    if (basemapImage) {
      ctx.drawImage(
        basemapImage,
        view.x, view.y, w / s, h / s,
        0, 0, w, h,
      )
    }

    // Tint the GROUND only. Everything drawn after this keeps its own colour.
    applyTint(ctx, mode, w, h)

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

    // Keep vehicles legible as the view pulls back. At city scale a real car
    // is about 2 px and the streets look empty; see MIN_CAR_PX.
    const carPx = CAR_LEN_ART * SPRITE_SCALE * s
    const exaggerate = Math.max(1, Math.min(MAX_EXAGGERATION, MIN_CAR_PX / carPx))
    const spriteScale = s * exaggerate

    for (let i = 0; i < vehCount; i++) {
      const o = i * STRIDE
      const lon = veh[o]
      const lat = veh[o + 1]
      const angDeg = veh[o + 2]
      const kind = veh[o + 3] | 0
      const speed = veh[o + 4]
      const turn = veh[o + 5]

      // One bad vehicle must not take the whole loop down.
      //
      // ctx.drawImage(undefined, ...) THROWS, and the throw happens inside the
      // requestAnimationFrame callback, so it does not just drop a sprite -- it
      // stops the loop permanently and the scene freezes with no error visible
      // on screen. A single NaN reaching frameIndex() is enough to do it:
      // frames[NaN] is undefined. SUMO already filters vehicles that report
      // INVALID_DOUBLE_VALUE, so this should never fire; it is here because the
      // cost of being wrong about that is the entire demo stopping.
      if (!Number.isFinite(lon) || !Number.isFinite(lat) ||
          !Number.isFinite(angDeg) || !Number.isFinite(speed)) {
        skipped++
        continue
      }

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
      if (!f) { skipped++; continue }
      const size = entry.size * spriteScale
      const half = size / 2
      ctx.drawImage(f, sx - half, sy - half, size, size)
      drawn++

      // Headlights: only while moving, and only for things that have them.
      //
      // The glow is deliberately restrained. An earlier pass used alpha 0.5
      // with a radius scaled off the sprite, and because the buffer composites
      // additively the beams of neighbouring vehicles summed into large white
      // patches that read as fog rather than as headlights -- worst exactly
      // where traffic is densest, which is where the map most needs to stay
      // readable. Lower alpha and a radius tied to the vehicle keep it as a
      // highlight rather than a light source.
      if (!stopped && kind !== KIND.bike && nightness > 0.05) {
        const big = kind === KIND.bus || kind === KIND.truck
        const ahead = (big ? 7 : 4) * spriteScale
        const hx = (sx + Math.cos(rad) * ahead) * gs
        const hy = (sy + Math.sin(rad) * ahead) * gs
        const r = (big ? 7 : 5) * spriteScale * gs
        gctx.globalAlpha = 0.22 * nightness
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
      const r = Math.max(1.5, 2.2 * s) * signalBoostFor(mode)
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
      // Surfaced rather than swallowed: a non-zero value means the wire is
      // carrying something the renderer could not use, which is worth knowing
      // before it becomes a visible gap in the traffic.
      skipped,
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
