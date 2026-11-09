/**
 * Shade from sun, buildings and trees. Run: node src/green/shade.test.mjs
 */
import { heightOf, localDate, shadedShare, shadeIndex, shadowOffset, shadows, sunPosition } from './shade.js'

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `   ${detail}` : ''}`)
  if (!ok) failures++
}
const deg = (r) => (r * 180) / Math.PI
const SD = [18.4745, -69.9395]

// Santo Domingo, 21 June: near solar noon the sun is almost overhead, slightly north.
const noon = sunPosition(localDate(2026, 6, 21, 12.55), ...SD)
check('June noon: sun ~85 deg up, in the north', deg(noon.altitude) > 82 && (deg(noon.azimuth) < 30 || deg(noon.azimuth) > 330),
  `alt ${deg(noon.altitude).toFixed(1)}, az ${deg(noon.azimuth).toFixed(0)}`)
// 21 December: lower, in the south.
const dec = sunPosition(localDate(2026, 12, 21, 12.2), ...SD)
check('December noon: ~48 deg up, in the south', Math.abs(deg(dec.altitude) - 48) < 3 && Math.abs(deg(dec.azimuth) - 180) < 15,
  `alt ${deg(dec.altitude).toFixed(1)}, az ${deg(dec.azimuth).toFixed(0)}`)
const pm = sunPosition(localDate(2026, 6, 21, 16), ...SD)
check('afternoon sun is in the west', deg(pm.azimuth) > 250 && deg(pm.azimuth) < 300, `az ${deg(pm.azimuth).toFixed(0)}`)
check('night: sun below the horizon', sunPosition(localDate(2026, 6, 21, 23), ...SD).altitude < 0)

const off = shadowOffset(10, pm)
check('afternoon shadows point east', off[0] > 0, `dx ${off[0].toFixed(1)} m`)
check('a 10 m wall at 45 deg casts ~10 m', Math.abs(Math.hypot(...shadowOffset(10, { altitude: Math.PI / 4, azimuth: 0 })) - 10) < 1e-6)

// A 12 m block west of a north-south street; afternoon sun in the west.
const block = { ring: [[-30, 0], [-5, 0], [-5, 100], [-30, 100]], h: 12 }
// Kept inside the block's length: points exactly on the shadow's edge are a
// boundary case, not what this tests.
const street = [[0, 5], [0, 95]]
const sun15 = { altitude: Math.PI / 4, azimuth: (270 * Math.PI) / 180 }
check('a block west of a street shades it in the afternoon', shadedShare(street, shadeIndex(shadows([block], [], sun15))) > 0.9)
const sun9 = { altitude: Math.PI / 4, azimuth: (90 * Math.PI) / 180 }
check('…and not in the morning', shadedShare(street, shadeIndex(shadows([block], [], sun9))) === 0)
check('a tree shades the spot its shadow falls on', shadedShare([[6, 50], [6, 50]], shadeIndex(shadows([], [[0, 50]], sun15))) === 1)
check('at night everything counts as shaded', shadedShare(street, shadeIndex(shadows([block], [], { altitude: -0.2, azimuth: 0 }))) === 1)

check('height from tags, levels, or assumed', heightOf({ height: '30' }).h === 30 && heightOf({ 'building:levels': '4' }).h === 12 &&
  heightOf({}).assumed === true)

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
