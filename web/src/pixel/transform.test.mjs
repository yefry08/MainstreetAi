/**
 * The lon/lat -> pixel transform, pinned.
 *
 * Everything Step 3 draws depends on this. If it drifts, vehicles and signals
 * land in buildings and it looks like a sprite bug -- the failure is silent and
 * points at the wrong file, which is the worst combination.
 *
 * The coefficients here were fitted by sim/basemap/build_basemap.py against
 * Barcelona's extent and verified against the rendered image itself: road
 * centrelines projected through this transform land on street pixels 99% of
 * the time and on buildings 0% of the time, while a deliberate 150 m offset
 * puts 21% of them on buildings.
 *
 * Run:  node src/pixel/transform.test.mjs
 */

import { createTransform, headingToCanvasRadians } from './transform.js'

let failures = 0
const check = (name, ok, detail) => {
  if (!ok) failures++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '   ' + detail : ''}`)
}
const near = (a, b, tol) => Math.abs(a - b) <= tol

// A synthetic but exactly-known transform: 1000 px over 0.01 deg in each axis,
// no rotation, no curvature. Chosen so every expected value can be computed by
// hand rather than copied from the implementation.
const LINEAR = {
  width_px: 1000,
  height_px: 1000,
  px_per_m: 0.5,
  lonlat_to_px: {
    // x = (lon - 2.00) * 100000 ; y = (41.40 - lat) * 100000
    kx: [-200000, 100000, 0, 0, 0, 0],
    ky: [4140000, 0, -100000, 0, 0, 0],
    basis: ['1', 'lon', 'lat', 'lon*lon', 'lon*lat', 'lat*lat'],
    max_error_px: 0,
  },
}

const t = createTransform(LINEAR)
check('valid metadata yields a usable transform', t.ok)
check('image size is carried through', t.width === 1000 && t.height === 1000)
check('metres per pixel inverts px_per_m', near(t.metresPerPixel, 2, 1e-9),
  `${t.metresPerPixel}`)

let p = t.toPx(2.0, 41.4, { x: 0, y: 0 })
check('origin corner maps to (0,0)', near(p.x, 0, 1e-6) && near(p.y, 0, 1e-6),
  `${p.x},${p.y}`)

p = t.toPx(2.01, 41.39, { x: 0, y: 0 })
check('opposite corner maps to (1000,1000)',
  near(p.x, 1000, 1e-6) && near(p.y, 1000, 1e-6), `${p.x},${p.y}`)

p = t.toPx(2.005, 41.395, { x: 0, y: 0 })
check('centre maps to the centre', near(p.x, 500, 1e-6) && near(p.y, 500, 1e-6),
  `${p.x},${p.y}`)

// Latitude increasing must move UP the image. Getting this backwards mirrors
// the whole city about its centre line, which is subtle on a symmetric grid.
const north = t.toPx(2.005, 41.396, { x: 0, y: 0 })
const south = t.toPx(2.005, 41.394, { x: 0, y: 0 })
check('north is up (smaller y)', north.y < south.y,
  `${north.y} < ${south.y}`)
const east = t.toPx(2.006, 41.395, { x: 0, y: 0 })
const west = t.toPx(2.004, 41.395, { x: 0, y: 0 })
check('east is right (larger x)', east.x > west.x, `${east.x} > ${west.x}`)

// The quadratic terms must actually be evaluated, or the fit silently
// degrades to the affine case that is 1.9 m out at the corners.
const CURVED = JSON.parse(JSON.stringify(LINEAR))
CURVED.lonlat_to_px.kx = [0, 0, 0, 1, 0, 0]   // x = lon^2
CURVED.lonlat_to_px.ky = [0, 0, 0, 0, 1, 0]   // y = lon*lat
const c = createTransform(CURVED)
p = c.toPx(3, 5, { x: 0, y: 0 })
check('quadratic terms are evaluated', near(p.x, 9, 1e-9) && near(p.y, 15, 1e-9),
  `x=${p.x} (want 9), y=${p.y} (want 15)`)

// Missing or malformed metadata must fail loudly, not draw a city in the sea.
for (const [label, meta] of [
  ['null metadata', null],
  ['no fit', { width_px: 10, height_px: 10 }],
  ['wrong coefficient count', { lonlat_to_px: { kx: [1, 2], ky: [1, 2] } }],
]) {
  const bad = createTransform(meta)
  const q = bad.toPx(2, 41)
  check(`${label} -> not ok, NaN out`, !bad.ok && Number.isNaN(q.x))
}

// Heading: SUMO degrees clockwise from north -> canvas radians from +x.
check('heading 0 (north) points up', near(headingToCanvasRadians(0), -Math.PI / 2, 1e-9))
check('heading 90 (east) points +x', near(headingToCanvasRadians(90), 0, 1e-9))
check('heading 180 (south) points down', near(headingToCanvasRadians(180), Math.PI / 2, 1e-9))

// The scratch object is reused on purpose; callers that need to keep a result
// must pass their own. Pinning it so the optimisation is not "fixed" later.
const a = t.toPx(2.001, 41.399)
const b = t.toPx(2.009, 41.391)
check('default output object is reused (documented)', a === b)

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
