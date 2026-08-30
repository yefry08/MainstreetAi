/**
 * lon/lat -> basemap pixel, with no projection library.
 *
 * The basemap is rendered by prettymaps through osmnx, which projects into the
 * LOCAL UTM zone -- EPSG:32631 for Barcelona, something else for the next city.
 * Every vehicle needs this conversion every frame, so the cost matters and so
 * does the accuracy.
 *
 * Doing it properly in the browser would mean shipping proj4js. It is not
 * needed: over a single city UTM is a very smooth function of lon/lat, and a
 * quadratic in two variables reproduces it to floating-point precision. The
 * build step fits the twelve coefficients and writes them into the sidecar;
 * this file just evaluates them.
 *
 * The naive alternative -- mapping the lon/lat bounding box linearly onto the
 * image -- is off by 39 m in the median and 73 m at worst over Barcelona's
 * 8.2 km extent. That is roughly a city block: every vehicle would sit visibly
 * inside a building, and it would look like a bug in the sprite code rather
 * than in the maths. The cause is meridian convergence, the rotation between
 * UTM grid north and true north (~0.56 degrees here). An axis-aligned scale
 * cannot express a rotation. Measured, fitted on a 12x12 grid and scored on
 * 4,000 points the fit never saw:
 *
 *     linear box       median 39 m      max 73 m
 *     affine           median 0.47 m    max 1.89 m
 *     quadratic        median 0.00 m    max 0.00 m
 */

/**
 * @param {object} meta parsed basemap_<city>.json
 * @returns {{toPx:(lon:number,lat:number,out?:{x:number,y:number})=>{x:number,y:number},
 *            width:number, height:number, metresPerPixel:number, ok:boolean}}
 */
export function createTransform(meta) {
  const fit = meta?.lonlat_to_px
  const width = meta?.width_px ?? 0
  const height = meta?.height_px ?? 0
  const metresPerPixel = meta?.px_per_m ? 1 / meta.px_per_m : 1

  if (!fit || !Array.isArray(fit.kx) || fit.kx.length !== 6) {
    // Refuse to guess. A transform that is quietly wrong draws a whole city
    // in the wrong place and looks like a rendering fault; an obvious null is
    // far cheaper to diagnose.
    return {
      ok: false,
      width,
      height,
      metresPerPixel,
      toPx: () => ({ x: NaN, y: NaN }),
    }
  }

  const [ax, bx, cx, dx, ex, fx] = fit.kx
  const [ay, by, cy, dy, ey, fy] = fit.ky

  // Reused scratch object: this runs once per vehicle per frame, and at ~1,400
  // vehicles and 60 fps a fresh {x,y} each time is 84,000 short-lived objects
  // a second for the collector to sweep.
  const scratch = { x: 0, y: 0 }

  const toPx = (lon, lat, out = scratch) => {
    const ll = lon * lat
    const l2 = lon * lon
    const a2 = lat * lat
    out.x = ax + bx * lon + cx * lat + dx * l2 + ex * ll + fx * a2
    out.y = ay + by * lon + cy * lat + dy * l2 + ey * ll + fy * a2
    return out
  }

  return { ok: true, toPx, width, height, metresPerPixel }
}

/**
 * Heading conversion.
 *
 * SUMO reports degrees CLOCKWISE FROM NORTH. Canvas rotation is clockwise from
 * the +x axis with y running DOWN the screen, so the two agree on direction of
 * rotation and differ only by the 90 degree offset between "up" and "+x".
 *
 * The map is in UTM, whose grid north is rotated slightly from true north, so
 * a heading is strictly speaking off by the meridian convergence -- 0.56
 * degrees for Barcelona. That is a third of a pixel of sprite rotation at any
 * plausible sprite size, so it is ignored here deliberately rather than
 * overlooked.
 */
export const headingToCanvasRadians = (degClockwiseFromNorth) =>
  (degClockwiseFromNorth - 90) * (Math.PI / 180)
