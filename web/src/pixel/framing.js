/**
 * Where the camera opens.
 *
 * The scene used to open framed to the whole simulated extent, which for
 * Barcelona is 9.4 km of city across a 1280 px canvas. That put the view at
 * scale 0.34 -- the illustrated basemap downsampled to a third of the
 * resolution it was baked at, and a car occupying 3.3 x 5.4 CSS pixels. At that
 * size none of the sprite work survives: no glass, no trim, no contact shadow,
 * no sense that these are vehicles rather than coloured specks. The pixel art
 * was there the whole time and simply too small to see.
 *
 * So the camera opens close instead, on a slice of city rather than all of it.
 *
 * WHY A TARGET IN METRES RATHER THAN A FIXED ZOOM
 * The districts differ in size by an order of magnitude -- Barcelona is 51.8
 * km2, Shibuya 4.6. A fixed scale that framed one would either bury the other
 * in empty margin or crop it to a few streets. Asking for a span in metres
 * gives every city the same apparent zoom, which is what makes them comparable
 * when you switch between them.
 */

// About 1.2 km across.
//
// This number is set by the vehicles, not by the map. Once sprites are sized
// from real metres (see renderer.js) a car covers 3.8 basemap px, so how many
// SCREEN pixels of car you get is purely a function of how far in the camera
// is. Proportionate and readable pull in opposite directions: at 2.4 km a
// correctly-sized car is 8 px and its silhouette is mush; at 600 m it is
// beautiful and there are four cars on screen.
//
// 1.2 km puts a car at ~16 device px -- enough for the roof, glass and shadow
// to separate -- while keeping a couple of dozen vehicles in frame. That is
// also the "fewer, better-looking vehicles" trade made deliberately rather
// than by accident.
export const TARGET_SPAN_M = 1200

/**
 * @param {object} meta      basemap sidecar (needs px_per_m and sim_extent)
 * @param {object} signals   signal_approaches geojson, or null
 * @param {number} deviceW   canvas backing-store width
 * @param {number} deviceH   canvas backing-store height
 * @param {function} toPx    lon/lat -> basemap pixel
 */
export function openingView(meta, signals, deviceW, deviceH, toPx) {
  const ext = meta.sim_extent
  const [x0, y1] = toPx(ext[0], ext[1])
  const [x1, y0] = toPx(ext[2], ext[3])
  const extW = Math.abs(x1 - x0)
  const extH = Math.abs(y1 - y0)

  // Never zoom out past the whole district. A small district asked to show
  // 2.4 km would otherwise sit in a frame of empty margin.
  const fitScale = Math.min(deviceW / extW, deviceH / extH)
  const wanted = deviceW / (TARGET_SPAN_M * (meta.px_per_m || 0.5))
  const scale = Math.max(wanted, fitScale)

  // Centre on where the signals actually are, not on the middle of the
  // bounding box. The extent is a rectangle drawn around the network and its
  // corners are frequently the quietest parts of it -- opening there shows a
  // city with no traffic in it, which is the specific failure this whole
  // framing step exists to avoid.
  let cx = (x0 + x1) / 2
  let cy = (y0 + y1) / 2
  const centre = signalCentroid(signals, toPx)
  if (centre) {
    cx = centre[0]
    cy = centre[1]
  }

  return {
    x: cx - deviceW / (2 * scale),
    y: cy - deviceH / (2 * scale),
    scale,
  }
}

/** Mean position of the signal lamps, in basemap pixels. */
export function signalCentroid(signals, toPx) {
  const feats = signals?.features
  if (!feats?.length) return null
  let sx = 0
  let sy = 0
  let n = 0
  for (const f of feats) {
    const c = f?.geometry?.coordinates
    // Approaches are points; anything else is skipped rather than guessed at.
    if (!Array.isArray(c) || c.length < 2) continue
    const [lon, lat] = c
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    const [px, py] = toPx(lon, lat)
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue
    sx += px
    sy += py
    n++
  }
  return n ? [sx / n, sy / n] : null
}
