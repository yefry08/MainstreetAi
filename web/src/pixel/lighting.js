/**
 * Day / sunset / night, done as a composite pass rather than as lighting.
 *
 * WHY NOT REAL LIGHTING
 * The basemap is a single pre-rendered PNG. Genuinely re-lighting it would mean
 * baking one variant per mode -- roughly 26 minutes each through prettymaps,
 * three times per city, and three times the asset weight for a page that
 * already ships 7.5 MB of map. That is not a lighting toggle, it is three
 * separate maps.
 *
 * WHAT THIS DOES INSTEAD
 * One tinted rectangle drawn between the basemap and the vehicles, with a
 * blend mode chosen per mode. Cost is a single fillRect per frame. Because it
 * lands UNDER the sprites, vehicles keep their own colours and stay
 * identifiable in every mode -- tinting them too would make a bus at night
 * read as a different vehicle rather than the same bus in different light.
 *
 * Each mode also scales the headlight bloom, which is the part that actually
 * sells it: `glow` is the multiplier the renderer applies to the additive
 * pass, so headlights are invisible at midday and dominant after dark.
 */

export const MODES = ['day', 'sunset', 'night']

export const LIGHTING = {
  day: {
    label: 'Day',
    // Nothing at all. The prettymaps art is already a daylight illustration,
    // so the honest "day" treatment is to leave it alone -- a nominal warm
    // wash would only mute it.
    tint: null,
    glow: 0,
    // Signals still have to read against a bright map.
    signalBoost: 1.0,
  },
  sunset: {
    label: 'Sunset',
    // Warm wash. `overlay` keeps the map's own light and dark structure
    // instead of flattening it the way a plain alpha fill would.
    tint: { colour: '#ff8a3d', alpha: 0.3, mode: 'overlay' },
    glow: 0.55,
    signalBoost: 1.1,
  },
  night: {
    label: 'Night',
    // `multiply` with a deep blue darkens without turning the map grey, which
    // is what a black overlay does. Streets stay legible as shapes while
    // losing their daylight colour.
    tint: { colour: '#1b2340', alpha: 0.78, mode: 'multiply' },
    glow: 1.0,
    signalBoost: 1.35,
  },
}

/** Draw the tint for a mode. No-op for day. */
export function applyTint(ctx, mode, w, h) {
  const cfg = LIGHTING[mode] ?? LIGHTING.day
  if (!cfg.tint) return
  const prev = ctx.globalCompositeOperation
  ctx.globalCompositeOperation = cfg.tint.mode
  ctx.globalAlpha = cfg.tint.alpha
  ctx.fillStyle = cfg.tint.colour
  ctx.fillRect(0, 0, w, h)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = prev
}

export const glowFor = (mode) => (LIGHTING[mode] ?? LIGHTING.day).glow
export const signalBoostFor = (mode) => (LIGHTING[mode] ?? LIGHTING.day).signalBoost
