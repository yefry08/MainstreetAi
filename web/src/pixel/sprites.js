/**
 * Pixel-art vehicle sprites, drawn once into offscreen canvases.
 *
 * Every vehicle is a handful of flat rectangles at a deliberately small pixel
 * size, then scaled up with smoothing disabled so the pixels stay square and
 * visible. Drawing them procedurally rather than shipping a PNG atlas keeps
 * the palette in one place with the rest of the design tokens, and means a new
 * vehicle type is a few lines rather than an art asset.
 *
 * WHY PRE-RENDER AT ALL
 * The alternative is issuing the same dozen fillRect calls per vehicle per
 * frame. At ~1,400 vehicles and 60 fps that is roughly a million rectangle
 * calls a second before anything moves. Baking each sprite once and then
 * blitting it is one drawImage per vehicle, which is the difference between
 * comfortable and unusable on the Intel N100 this restructure is aimed at.
 *
 * ROTATION IS BAKED, NOT APPLIED PER FRAME
 * ctx.rotate() forces a transform change and a fresh composite per vehicle.
 * Instead each sprite is pre-rendered at ROTATIONS fixed angles and the
 * nearest one is blitted. At 32 steps the worst angular error is 5.6 degrees,
 * which on a 12 px sprite is under a pixel of tip displacement -- invisible,
 * and it removes per-vehicle transform state entirely.
 */

// Vehicle kinds on the wire: 0 car, 1 bus, 2 bike, 3 truck, 4 moto.
export const KIND = { car: 0, bus: 1, bike: 2, truck: 3, moto: 4 }

export const ROTATIONS = 32

// Palette. Warm body colours read against the prettymaps cream streets; the
// bus is deliberately the most saturated thing on the map because the whole
// transit-priority argument is about buses being visible.
const PALETTE = {
  car: { body: '#d9d2c5', trim: '#8a8272', glass: '#3d4a57' },
  bus: { body: '#d97757', trim: '#a8563a', glass: '#2f3a45' },
  bike: { body: '#4fd8e8', trim: '#2f9aa8', glass: '#2f3a45' },
  truck: { body: '#8a94a6', trim: '#5d6675', glass: '#2f3a45' },
  moto: { body: '#f0c14b', trim: '#b08a2e', glass: '#2f3a45' },
  stopped: '#f0454f',
  // A diorama reads as a diorama because things sit ON something. This is the
  // contact shadow that puts each vehicle on the road surface instead of
  // floating above it. Kept translucent so overlapping traffic in a queue does
  // not stack into a black mass.
  shadow: 'rgba(28, 22, 18, 0.34)',
}

/**
 * Body plans in sprite pixels, drawn nose-UP (heading 0 = north).
 * Each entry: [x, y, w, h, colourKey].
 */
const PLANS = {
  car: { w: 6, h: 10, parts: [
    [1, 0, 4, 10, 'body'], [0, 2, 6, 6, 'body'],
    [1, 2, 4, 3, 'glass'], [1, 7, 4, 2, 'trim'],
  ] },
  bus: { w: 7, h: 20, parts: [
    [0, 0, 7, 20, 'body'],
    [1, 2, 5, 4, 'glass'], [1, 8, 5, 3, 'glass'], [1, 13, 5, 3, 'glass'],
    [0, 18, 7, 2, 'trim'],
  ] },
  bike: { w: 3, h: 6, parts: [
    [1, 0, 1, 6, 'body'], [0, 2, 3, 2, 'body'],
  ] },
  truck: { w: 7, h: 16, parts: [
    [0, 0, 7, 5, 'body'], [1, 1, 5, 2, 'glass'],
    [0, 5, 7, 11, 'trim'],
  ] },
  moto: { w: 3, h: 7, parts: [
    [1, 0, 1, 7, 'body'], [0, 3, 3, 2, 'body'],
  ] },
}

const NAME_BY_KIND = ['car', 'bus', 'bike', 'truck', 'moto']

// Screen-space offset of the contact shadow, in ART pixels. Applied BEFORE the
// heading rotation so every vehicle's shadow falls the same way regardless of
// which direction it is driving -- a shadow that rotates with the car reads as
// a lighting bug, because a single sun does not turn with the traffic.
const SHADOW_DX = 1
const SHADOW_DY = 1

function drawPlan(ctx, name, scale, stopped, shadowOnly = false) {
  const plan = PLANS[name]
  const pal = PALETTE[name]
  for (const [x, y, w, h, key] of plan.parts) {
    if (shadowOnly) {
      ctx.fillStyle = PALETTE.shadow
      ctx.fillRect(x * scale, y * scale, w * scale, h * scale)
      continue
    }
    // A stopped vehicle recolours only its BODY. Recolouring the glass too
    // turned the sprite into a solid red lozenge at small sizes, which read as
    // a different vehicle type rather than as the same one halted.
    ctx.fillStyle = stopped && key === 'body' ? PALETTE.stopped : pal[key]
    ctx.fillRect(x * scale, y * scale, w * scale, h * scale)
  }
}

/**
 * Build every sprite once.
 * @param {number} scale sprite pixels per art pixel (chunkiness)
 */
export function buildSpriteSheet(scale = 2) {
  const sheet = {}
  for (const name of NAME_BY_KIND) {
    for (const stopped of [false, true]) {
      const plan = PLANS[name]
      // The rotated sprite must fit its own diagonal, or corners clip when it
      // points at 45 degrees.
      // Padding covers the rotation diagonal AND the shadow offset; too tight
      // and the shadow is clipped off at some headings but not others.
      const src = Math.ceil(Math.hypot(plan.w, plan.h) * scale)
                  + 2 + Math.ceil(Math.max(SHADOW_DX, SHADOW_DY) * scale)
      const frames = []
      for (let i = 0; i < ROTATIONS; i++) {
        const c = document.createElement('canvas')
        c.width = c.height = src
        const ctx = c.getContext('2d')
        ctx.imageSmoothingEnabled = false
        const angle = (i / ROTATIONS) * Math.PI * 2
        const orient = () => {
          ctx.rotate(angle)
          ctx.translate(-(plan.w * scale) / 2, -(plan.h * scale) / 2)
        }

        // Shadow first, displaced in screen space, then the body over it.
        ctx.save()
        ctx.translate(src / 2 + SHADOW_DX * scale, src / 2 + SHADOW_DY * scale)
        orient()
        drawPlan(ctx, name, scale, stopped, true)
        ctx.restore()

        ctx.translate(src / 2, src / 2)
        orient()
        drawPlan(ctx, name, scale, stopped)
        frames.push(c)
      }
      sheet[`${name}${stopped ? ':stopped' : ''}`] = { frames, size: src }
    }
  }
  return sheet
}

/** Nearest baked rotation for a canvas-space angle in radians. */
export function frameIndex(radians) {
  const t = radians / (Math.PI * 2)
  return ((Math.round(t * ROTATIONS) % ROTATIONS) + ROTATIONS) % ROTATIONS
}

export const spriteKey = (kind, stopped) =>
  `${NAME_BY_KIND[kind] ?? 'car'}${stopped ? ':stopped' : ''}`

export { PALETTE, NAME_BY_KIND }
