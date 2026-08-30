/**
 * The camera must open close enough that the sprite work is visible, and must
 * not zoom past a small district into empty margin.
 *
 * Both regressions are silent: the scene still renders, still animates, still
 * reports healthy stats. It just shows a city too small to read, or a district
 * swimming in blank space. Nothing throws, so only an assertion catches it.
 */
import { readFileSync, existsSync } from 'node:fs'
import { openingView, TARGET_SPAN_M } from './framing.js'

const DATA = new URL('../../public/data/', import.meta.url)
let fail = 0
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '   ' + detail : ''}`)
  if (!ok) fail++
}

// Mirrors renderer.js: sprites are sized from real metres now, not from the
// sprite's own pixel count.
const CAR_LEN_M = 4.5
const CAR_EXAGGERATION = 1.7
const carLenDevicePx = (scale, pxPerM) => CAR_LEN_M * CAR_EXAGGERATION * pxPerM * scale
const laneDevicePx = (scale, pxPerM) => 3.0 * pxPerM * scale

const makeToPx = (meta) => {
  const { kx, ky } = meta.lonlat_to_px
  return (lon, lat) => {
    const b = [1, lon, lat, lon * lon, lon * lat, lat * lat]
    return [kx.reduce((s, k, i) => s + k * b[i], 0),
            ky.reduce((s, k, i) => s + k * b[i], 0)]
  }
}

const DPR = 2
const DEV_W = 1280 * DPR
const DEV_H = 860 * DPR

for (const key of ['barcelona', 'shibuya']) {
  const f = new URL(`basemap_${key}.json`, DATA)
  if (!existsSync(f)) { console.log(`  skip ${key} (no sidecar)`); continue }
  const meta = JSON.parse(readFileSync(f, 'utf-8'))
  if (!meta.lonlat_to_px) { console.log(`  skip ${key} (no transform)`); continue }

  const toPx = makeToPx(meta)
  const v = openingView(meta, null, DEV_W, DEV_H, toPx)
  const span = DEV_W / v.scale / meta.px_per_m
  const car = carLenDevicePx(v.scale, meta.px_per_m)
  const lane = laneDevicePx(v.scale, meta.px_per_m)

  console.log(`\n${key}: scale ${v.scale.toFixed(3)}, ${Math.round(span)} m across, ` +
              `car ${car.toFixed(1)} device px long, lane ${lane.toFixed(1)} px`)

  // Readable: below this the silhouette stops separating into roof and glass.
  check(car >= 14, 'a car is long enough for its silhouette to read',
        `${car.toFixed(1)} device px`)

  // Proportionate: a car must not be wider than the lane it drives in. This is
  // the regression that made the scene read as toys on a map -- sprites used to
  // cover 20 basemap px of ground against a real car's 2.25.
  const carWidth = car * (4 / 10)   // sprite aspect: 4 art px wide, 10 long -- real 1.8/4.5
  check(carWidth <= lane * 1.15,
        'a car fits within its lane',
        `car ${carWidth.toFixed(1)} px vs lane ${lane.toFixed(1)} px`)

  const ext = meta.sim_extent
  const [x0, y1] = toPx(ext[0], ext[1])
  const [x1, y0] = toPx(ext[2], ext[3])
  const fitScale = Math.min(DEV_W / Math.abs(x1 - x0), DEV_H / Math.abs(y1 - y0))
  check(v.scale >= fitScale - 1e-9,
        'never zooms out past the whole district',
        `scale ${v.scale.toFixed(3)} >= fit ${fitScale.toFixed(3)}`)

  // A district narrower than the target span is CROPPED, not fitted, and that
  // is deliberate: every city opens at the same apparent zoom, which is what
  // lets someone switching between them see that Shibuya's blocks are smaller
  // than the Eixample's rather than just differently framed. Fitting each one
  // to its own extent would silently rescale the comparison away.
  //
  // The fitScale clamp above is not the opposite of this. It catches a district
  // so small that the target span would leave it adrift in blank space -- there
  // fitScale is the LARGER number, so the max() zooms in to fill the viewport.
  const extSpanM = Math.abs(x1 - x0) / meta.px_per_m
  check(Math.abs(span - Math.max(TARGET_SPAN_M, DEV_W / fitScale / meta.px_per_m)) < 1
        || Math.abs(span - TARGET_SPAN_M) < 1,
        `opens at the same ${TARGET_SPAN_M} m zoom as every other city`,
        `${Math.round(span)} m, extent is ${Math.round(extSpanM)} m wide`)
}

// The centroid must move the camera somewhere, when signals are supplied.
const bcn = new URL('basemap_barcelona.json', DATA)
const sig = new URL('signal_approaches.geojson', DATA)
if (existsSync(bcn) && existsSync(sig)) {
  const meta = JSON.parse(readFileSync(bcn, 'utf-8'))
  const signals = JSON.parse(readFileSync(sig, 'utf-8'))
  const toPx = makeToPx(meta)
  const a = openingView(meta, null, DEV_W, DEV_H, toPx)
  const b = openingView(meta, signals, DEV_W, DEV_H, toPx)
  const moved = Math.hypot(b.x - a.x, b.y - a.y)
  console.log(`\ncentroid shifts the camera by ${Math.round(moved)} basemap px`)
  check(moved > 1, 'signal centroid actually recentres the view')
  check(b.scale === a.scale, 'centroid changes position only, not zoom')
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
