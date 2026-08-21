/**
 * Geographic <-> scene-space projection.
 *
 * This is the piece deck.gl used to do for us, so it is worth being explicit
 * about the coordinate systems involved:
 *
 *   WGS84         lng/lat degrees.
 *   Mercator      MapLibre's world space. The whole planet is the unit square
 *                 [0,1] x [0,1]. x grows east, y grows SOUTH, z is altitude in
 *                 the same units. This is what MapLibre's render matrix
 *                 expects.
 *   Scene         Our three.js space: METRES relative to a fixed origin near
 *                 the middle of Barcelona. x east, y north, z up.
 *
 * Why not just put three.js in Mercator units directly? Precision. Barcelona
 * sits around x=0.5045, y=0.3805, and a 4-metre car is about 3e-8 mercator
 * units. float32 (which is what a GPU vertex buffer holds) has ~7 decimal
 * digits, so the car would be smaller than the representable step at that
 * magnitude and the whole scene would jitter apart. Working in metres from a
 * local origin keeps every coordinate in a range float32 handles comfortably,
 * and the origin offset is folded into the model matrix, which is float64 on
 * the CPU side.
 *
 * Deliberately dependency-free: no maplibre-gl import, so it can be verified in
 * Node without a DOM. `verifyProjection()` cross-checks it against MapLibre's
 * own MercatorCoordinate at runtime in the browser.
 */

// WGS84 equatorial circumference, metres. Matches MapLibre's constant.
export const EARTH_CIRCUMFERENCE = 40075016.686

/** lng/lat degrees -> normalised Mercator [0,1]. y grows south. */
export function lngLatToMercator(lng, lat, altitude = 0) {
  const x = (180 + lng) / 360
  const y =
    (180 -
      (180 / Math.PI) *
        Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) /
    360
  return { x, y, z: altitude / mercatorScaleDenominator(lat) }
}

/** Normalised Mercator -> lng/lat degrees. */
export function mercatorToLngLat(x, y) {
  const lng = x * 360 - 180
  const y2 = 180 - y * 360
  const lat = (360 / Math.PI) * Math.atan(Math.exp((y2 * Math.PI) / 180)) - 90
  return [lng, lat]
}

/**
 * Metres per Mercator unit at a given latitude. Mercator compresses toward the
 * poles, so this is latitude-dependent and must be evaluated at the scene
 * origin, not the equator.
 */
export function mercatorScaleDenominator(lat) {
  return EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)
}

/**
 * Builds the transform pair for a scene anchored at `origin` (lng/lat).
 */
export function createProjection(originLngLat) {
  const [oLng, oLat] = originLngLat
  const origin = lngLatToMercator(oLng, oLat, 0)
  // Mercator units per metre at this latitude.
  const unitsPerMetre = 1 / mercatorScaleDenominator(oLat)
  const metresPerUnit = mercatorScaleDenominator(oLat)

  /** lng/lat/alt -> scene metres {x east, y north, z up}. */
  function toScene(lng, lat, altitude = 0) {
    const m = lngLatToMercator(lng, lat, 0)
    return {
      x: (m.x - origin.x) * metresPerUnit,
      // Negated: Mercator y grows south, our scene y grows north.
      y: -(m.y - origin.y) * metresPerUnit,
      z: altitude,
    }
  }

  /** scene metres -> lng/lat. */
  function toLngLat(x, y) {
    const mx = x / metresPerUnit + origin.x
    const my = -y / metresPerUnit + origin.y
    return mercatorToLngLat(mx, my)
  }

  return { origin, unitsPerMetre, metresPerUnit, toScene, toLngLat, originLngLat }
}

/**
 * Great-circle distance in metres. Used to check that scene-space distances
 * agree with reality — Mercator distorts, so a scene metre is only a true
 * metre near the origin latitude, and this is how we measure the error.
 */
export function haversineMetres(a, b) {
  const R = 6371008.8
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLon = ((b[0] - a[0]) * Math.PI) / 180
  const la1 = (a[1] * Math.PI) / 180
  const la2 = (b[1] * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Runtime cross-check against MapLibre's own MercatorCoordinate.
 *
 * If these two ever disagree, every vehicle in the scene is in the wrong place,
 * and it would be a silent, plausible-looking wrongness — cars sliding along
 * near-but-not-quite the right streets. Cheap to assert, expensive to debug.
 * Returns the worst disagreement in metres.
 */
export function verifyProjection(maplibregl, samples) {
  let worst = 0
  let worstAt = null
  for (const [lng, lat] of samples) {
    const mine = lngLatToMercator(lng, lat, 0)
    const theirs = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat }, 0)
    const dx = (mine.x - theirs.x) * mercatorScaleDenominator(lat)
    const dy = (mine.y - theirs.y) * mercatorScaleDenominator(lat)
    const err = Math.hypot(dx, dy)
    if (err > worst) {
      worst = err
      worstAt = [lng, lat]
    }
  }
  return { worstErrorMetres: worst, worstAt }
}
