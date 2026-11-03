/**
 * Live congestion from Mapbox Traffic. Run: node src/city/liveMapbox.test.mjs
 *
 * No network: features are given in levelLengths' decoded shape, so this pins
 * the tile maths and the level -> ratio rule, not Mapbox's protobuf (the
 * decoder is @mapbox/vector-tile's).
 */
import { tilesFor, levelLengths, summariseLevels, LEVEL_RATIO } from './liveMapbox.js'

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `   ${detail}` : ''}`)
  if (!ok) failures++
}

// Buenos Aires centre at z14 is tile 5534/9872 (checked against Mapbox).
const ba = [-58.3817, -34.6038, -58.3815, -34.6036]
check('a small box is one tile, the right one', JSON.stringify(tilesFor(ba, 14)) === '[[5534,9872]]')
const wide = tilesFor([-58.40, -34.62, -58.37, -34.59], 14)
check('a 3 km box spans a few tiles, not dozens', wide.length >= 2 && wide.length <= 6, `${wide.length}`)

// One horizontal line across the middle of the tile, half of it inside bounds.
const n = 2 ** 14, tx = 5534, ty = 9872
const tileW = 360 / n
const west = tx * tileW - 180
const line = (congestion) => ({ congestion, extent: 4096,
  rings: [[{ x: 0, y: 2048 }, { x: 1024, y: 2048 }, { x: 2048, y: 2048 }, { x: 3072, y: 2048 }, { x: 4096, y: 2048 }]] })
const half = [west, -90, west + tileW / 2, 90]
const m = levelLengths([line('heavy'), line('low'), line('closed')], 14, tx, ty, half)
const widthM = tileW * 111320 * Math.cos((34.6 * Math.PI) / 180)
check('only the half inside the bounds is measured', Math.abs(m.heavy - widthM / 2) < 5,
  `${m.heavy.toFixed(0)} m vs ${(widthM / 2).toFixed(0)} m`)
check('unknown levels are ignored', !('closed' in m))

const s = summariseLevels({ low: 3000, heavy: 1000 })
check('ratio is the length-weighted level ratio', Math.abs(s.ratio - (0.75 * LEVEL_RATIO.low + 0.25 * LEVEL_RATIO.heavy)) < 1e-9)
check('shares sum to 1', Math.abs(Object.values(s.shares).reduce((a, b) => a + b, 0) - 1) < 1e-9)
check('too little road -> null', summariseLevels({ low: 50 }) === null)
check('worse levels mean lower ratio',
  ['low', 'moderate', 'heavy', 'severe'].map((l) => LEVEL_RATIO[l]).every((r, i, a) => !i || r < a[i - 1]))

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
