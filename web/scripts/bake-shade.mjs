/**
 * Shade on a district's streets and bike lanes, hour by hour, from the real sun,
 * every building's height and every mapped tree (src/green/shade.js).
 *
 *   node scripts/bake-shade.mjs santo-domingo [--date 2026-07-15]
 *
 * Reads the Green tab's result for the same area (public/green/<slug>.json --
 * its bike network and planting candidates) and adds, for HOURS:
 *   - the share of the whole bike network in shade,
 *   - each bike-lane piece's and each candidate street's shade,
 * written to public/shade/<slug>.json.
 *
 * The default date is mid-July: the hottest stretch of Santo Domingo's year,
 * which is when shade on a bike lane matters.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fromFile } from 'geotiff'
import { fetchCity } from '../src/city/osm.js'
import { projector } from '../src/transit/coverage.js'
import { heightOf, localDate, shadedShare, shadeIndex, shadows, sunPosition } from '../src/green/shade.js'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(WEB, '.cache', 'shade')
const OUT = join(WEB, 'public', 'shade')
mkdirSync(CACHE, { recursive: true }); mkdirSync(OUT, { recursive: true })

const AREAS = { 'santo-domingo': { iso: 'DO-01', box: [18.415, -70.005, 18.535, -69.870] } }
export const HOURS = [9, 12, 15, 17]
const args = process.argv.slice(2)
const slug = args.find((a) => !a.startsWith('--') && !/^\d{4}-/.test(a)) ?? 'santo-domingo'
const di = args.indexOf('--date')
const [Y, M, D] = (di >= 0 ? args[di + 1] : '2026-07-15').split('-').map(Number)
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000))

const query = (iso, [s, w, n, e]) => `[out:json][timeout:180];
area["ISO3166-2"="${iso}"]["boundary"="administrative"]->.a;
way["building"](area.a)(${s},${w},${n},${e});
out tags geom;
node["natural"="tree"](area.a)(${s},${w},${n},${e});
out skel;`

function tiles([s, w, n, e], k = 4) {
  const out = []
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    out.push([s + ((n - s) * i) / k, w + ((e - w) * j) / k, s + ((n - s) * (i + 1)) / k, w + ((e - w) * (j + 1)) / k])
  }
  return out
}

const area = AREAS[slug]
const green = JSON.parse(readFileSync(join(WEB, 'public', 'green', `${slug}.json`), 'utf8'))
const centre = green.centre
const p = projector(centre[0], centre[1])

// ---- buildings and trees, tiled and cached ---------------------------------
const els = new Map()
for (const [i, t] of tiles(area.box).entries()) {
  const file = join(CACHE, `${slug}_${i}.json`)
  let got = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
  for (const pause of got ? [] : [0, 30, 90, 180]) {
    if (pause) await sleep(pause)
    try {
      got = (await fetchCity(t, { ql: query(area.iso, t), timeoutMs: 240000, allowEmpty: true,
        headers: { 'User-Agent': 'mainstreetai-bake/1.0 (github.com/yefry08/MainstreetAi)' } })).elements
      writeFileSync(file, JSON.stringify(got)); break
    } catch (e) { console.log(`retry  tile ${i + 1}/16: ${e.message.slice(0, 80)}`) }
  }
  if (!got) { console.log(`FAIL   tile ${i + 1}/16 (finished tiles are cached; run again)`); process.exit(1) }
  for (const el of got) els.set(`${el.type}/${el.id}`, el)
  console.log(`  tile ${i + 1}/16: ${got.length}`)
}

const buildings = [], trees = []
let assumed = 0
for (const el of els.values()) {
  if (el.type === 'node') { trees.push(p.xy(el.lat, el.lon)); continue }
  if (!el.geometry || el.geometry.length < 4) continue
  const { h, assumed: a } = heightOf(el.tags)
  if (a) assumed++
  buildings.push({ ring: el.geometry.map((g) => p.xy(g.lat, g.lon)), h })
}
console.log(`buildings ${buildings.length} (${Math.round((assumed / Math.max(buildings.length, 1)) * 100)}% height assumed), trees ${trees.length}`)

// ---- the measured canopy casts shade too ---------------------------------------
// OSM maps ~460 trees here; WorldCover measures ~15 km2 of canopy. An external
// audit (2026-11-09) found the first version shading with the 460 alone. Every
// WorldCover tree pixel near a street now stands in for a canopy (TREE_R disc
// at TREE_H), so the shade includes the trees that are actually there.
const tiff = await fromFile(join(WEB, '.cache', 'worldcover', 'N18W072.tif'))
const img = await tiff.getImage()
const [ox, oy] = img.getOrigin()
const [rx, ry] = img.getResolution()
const [S, W, N, E] = area.box
const x0 = Math.floor((W - ox) / rx), x1 = Math.ceil((E - ox) / rx)
const y0 = Math.floor((N - oy) / ry), y1 = Math.ceil((S - oy) / ry)
const [band] = await img.readRasters({ window: [x0, y0, x1, y1] })
const width = x1 - x0
let canopyPx = 0
for (let i = 0; i < band.length; i++) {
  if (band[i] !== 10 && band[i] !== 95) continue
  const lon = ox + (x0 + (i % width) + 0.5) * rx, lat = oy + (y0 + Math.floor(i / width) + 0.5) * ry
  trees.push(p.xy(lat, lon)); canopyPx++
}
console.log(`canopy pixels from WorldCover: ${canopyPx.toLocaleString()} (plus ${els.size - buildings.length} OSM tree nodes)`)

// ---- shade per date and hour ------------------------------------------------------
const toXY = (line) => line.map(([lon, lat]) => p.xy(lat, lon))
const len = (l) => l.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - l[i][0], q[1] - l[i][1]), 0)
// A closed loop is a track or a park circuit, not a way to get anywhere: one
// 310 m loop by the Centro Olimpico read 86-100% shaded at every hour.
const isLoop = (l) => l.length > 3 && Math.hypot(l[0][0] - l.at(-1)[0], l[0][1] - l.at(-1)[1]) < 5
const bikeAll = green.bike.lines.map(toXY)
const bikeKeep = bikeAll.map((l) => !isLoop(l))
const plant = green.planting.map((g) => g.lines.map(toXY))
// The year's extremes and middles: equinoxes and solstices, plus mid-July heat.
const DATES = [[3, 21], [6, 21], [7, 15], [9, 21], [12, 21]]
const dates = []
for (const [mm, dd] of DATES) {
  const hours = []
  for (const hour of HOURS) {
    const sun = sunPosition(localDate(Y, mm, dd, hour), centre[0], centre[1])
    const isShaded = shadeIndex(shadows(buildings, trees, sun))
    let shadedM = 0, totalM = 0
    const bikeShare = bikeAll.map((l, i) => {
      const s = shadedShare(l, isShaded)
      if (bikeKeep[i]) { const L = len(l); shadedM += s * L; totalM += L }
      return Math.round(s * 100) / 100
    })
    const plantShare = plant.map((ls) => {
      const L = ls.reduce((s, l) => s + len(l), 0)
      return Math.round((ls.reduce((s, l) => s + shadedShare(l, isShaded) * len(l), 0) / Math.max(L, 1)) * 100) / 100
    })
    hours.push({ hour, altitude: Math.round((sun.altitude * 180) / Math.PI), azimuth: Math.round((sun.azimuth * 180) / Math.PI),
                 bikeShaded: Math.round((shadedM / Math.max(totalM, 1)) * 100) / 100, bike: bikeShare, planting: plantShare })
  }
  dates.push({ date: `${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`, hours })
  console.log(`  ${dates.at(-1).date}: ` + hours.map((h) => `${h.hour}h ${Math.round(h.bikeShaded * 100)}%`).join('  '))
}
const july = dates.find((d) => d.date === '07-15')
writeFileSync(join(OUT, `${slug}.json`), JSON.stringify({ slug, date: `${Y}-07-15`,
  buildings: buildings.length, heightAssumedShare: Math.round((assumed / Math.max(buildings.length, 1)) * 100) / 100,
  trees: els.size - buildings.length, canopyPixels: canopyPx, loopsExcluded: bikeKeep.filter((k) => !k).length,
  // `hours` stays mid-July for the existing view; `dates` holds the year.
  hours: july.hours, dates, generated: new Date().toISOString() }))
console.log(`baked  shade ${slug}`)
