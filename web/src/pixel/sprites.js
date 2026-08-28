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
//
// Each vehicle now carries four tones rather than two: a lit roof, the body,
// a shaded flank, and glass. Three-value shading is what separates pixel art
// from coloured rectangles -- with a single flat fill the silhouette is the
// only information in the sprite, and at these sizes the silhouette alone is
// not enough to tell a hatchback from a van.
const PALETTE = {
  car:   { lit: '#f2ece1', body: '#d9d2c5', shade: '#a89f8e', trim: '#6f6759', glass: '#39434f' },
  bus:   { lit: '#f09a72', body: '#d97757', shade: '#a8563a', trim: '#7d3f2a', glass: '#2f3a45' },
  bike:  { lit: '#8ae8f2', body: '#4fd8e8', shade: '#2f9aa8', trim: '#1f6b76', glass: '#2f3a45' },
  truck: { lit: '#aab3c2', body: '#8a94a6', shade: '#5d6675', trim: '#414957', glass: '#2f3a45' },
  moto:  { lit: '#ffd97a', body: '#f0c14b', shade: '#b08a2e', trim: '#7d611f', glass: '#2f3a45' },
  stopped: '#f0454f',
  // Brake lights read at a glance where a body-colour change does not: a
  // stopped queue becomes a line of red points rather than a subtly different
  // shade of the same traffic.
  brake: '#ff5a4f',
  // A diorama reads as a diorama because things sit ON something. This is the
  // contact shadow that puts each vehicle on the road surface instead of
  // floating above it. Kept translucent so overlapping traffic in a queue does
  // not stack into a black mass.
  shadow: 'rgba(28, 22, 18, 0.34)',
}

/**
 * Body plans in art pixels, drawn nose-UP (heading 0 = north).
 * Each entry: [x, y, w, h, colourKey].
 *
 * PROPORTIONS ARE REAL, AND THAT IS THE POINT
 * Every plan is laid out at ART_PX_PER_M, so a sprite's shape is its vehicle's
 * actual footprint rather than whatever looked right in isolation. The old car
 * was 6 x 10 -- an aspect of 0.60 against a real car's 1.8 m / 4.5 m = 0.40 --
 * so once sprites were sized correctly by LENGTH they still came out half again
 * too wide and sat across the lane markings. Deriving both axes from metres
 * makes that class of mistake impossible rather than merely fixed.
 *
 *   car    1.8 x 4.5 m      bus   2.55 x 12 m
 *   truck  2.4 x 7.5 m      bike  0.6 x 1.8 m      moto  0.8 x 2.1 m
 */
export const ART_PX_PER_M = 10 / 4.5   // a 4.5 m car is 10 art px long

const PLANS = {
  // 4 x 10. Roof lit, flanks shaded, glass front and rear, brake bar at the
  // tail -- the smallest set of parts that still reads as a specific car.
  car: { w: 4, h: 10, parts: [
    [0, 1, 4, 8, 'shade'],      // body sides
    [1, 0, 2, 10, 'body'],      // centre spine, slightly proud of the flanks
    [1, 1, 2, 2, 'glass'],      // windscreen
    [1, 4, 2, 3, 'lit'],        // roof catching the light
    [1, 8, 2, 1, 'glass'],      // rear window
    [0, 9, 4, 1, 'brake'],      // tail lights
  ] },
  // 6 x 27. A bus is genuinely enormous next to a car and should look it --
  // that contrast is the transit-priority argument made visually.
  bus: { w: 6, h: 27, parts: [
    [0, 0, 6, 27, 'shade'],
    [1, 0, 4, 27, 'body'],
    [1, 1, 4, 3, 'glass'],      // windscreen
    [1, 6, 4, 4, 'glass'],      // window bays
    [1, 12, 4, 4, 'glass'],
    [1, 18, 4, 4, 'glass'],
    [1, 5, 4, 1, 'lit'],        // roof ribs
    [1, 17, 4, 1, 'lit'],
    [0, 26, 6, 1, 'brake'],
  ] },
  // 5 x 17. Cab and box, which is the silhouette that says "delivery" at a
  // glance and is most of why vans read differently from cars in traffic.
  truck: { w: 5, h: 17, parts: [
    [0, 0, 5, 17, 'shade'],
    [1, 0, 3, 5, 'body'],       // cab
    [1, 1, 3, 2, 'glass'],
    [0, 5, 5, 11, 'trim'],      // box body, deliberately duller than the cab
    [1, 6, 3, 9, 'lit'],        // box roof
    [0, 16, 5, 1, 'brake'],
  ] },
  // 2 x 4 and 2 x 5. At this size a rider is two pixels; the useful signal is
  // the bright body colour, not any internal detail.
  bike: { w: 2, h: 4, parts: [
    [0, 0, 2, 4, 'body'],
    [0, 1, 2, 1, 'lit'],
  ] },
  moto: { w: 2, h: 5, parts: [
    [0, 0, 2, 5, 'body'],
    [0, 1, 2, 1, 'lit'],
    [0, 4, 2, 1, 'brake'],
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
    //
    // Shared colours (brake) live at the top of PALETTE, not per vehicle, so
    // the lookup falls through to it. Without that fallback fillStyle is set
    // to undefined, which canvas ignores -- it silently keeps the PREVIOUS
    // colour, so the part is drawn in whatever the last rectangle used and
    // nothing reports an error.
    const colour = stopped && key === 'body'
      ? PALETTE.stopped
      : pal[key] ?? PALETTE[key]
    if (!colour) continue
    ctx.fillStyle = colour
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
