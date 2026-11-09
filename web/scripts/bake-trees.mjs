/**
 * Trees missing, trees to plant, where, and their climate benefits, for a
 * district (src/green/canopy.js).
 *
 *   node scripts/bake-trees.mjs santo-domingo
 *
 * Inputs:
 *   ESA WorldCover 2021 v200, 10 m land cover (web/.cache/worldcover, gitignored;
 *     https://esa-worldcover.org, CC-BY 4.0) -- the canopy, measured;
 *   the district's boundary and neighbourhood names from OpenStreetMap;
 *   its streets, from the Green tab's cached extract (web/.cache/green).
 * Output: public/trees/<slug>.json -- 250 m cells and district totals.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fromFile } from 'geotiff'
import { fetchCity } from '../src/city/osm.js'
import { CROWN_M2, WC, benefits, cellPlan, districtDeficit, pixelArea, TARGET } from '../src/green/canopy.js'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(WEB, '.cache', 'trees')
const OUT = join(WEB, 'public', 'trees')
mkdirSync(CACHE, { recursive: true }); mkdirSync(OUT, { recursive: true })

const AREAS = {
  'santo-domingo': { name: 'Santo Domingo — Distrito Nacional', iso: 'DO-01', box: [18.415, -70.005, 18.535, -69.870],
                     tile: 'N18W072.tif', green: 'santo-domingo.json' },
}
const CELL_M = 250
const slug = process.argv[2] ?? 'santo-domingo'
const A = AREAS[slug]
const [S, W, N, E] = A.box
const UA = { 'User-Agent': 'mainstreetai-bake/1.0 (github.com/yefry08/MainstreetAi)' }

async function cachedOverpass(name, ql) {
  const f = join(CACHE, `${slug}_${name}.json`)
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'))
  for (const pause of [0, 30, 90]) {
    if (pause) await new Promise((r) => setTimeout(r, pause * 1000))
    try {
      const els = (await fetchCity(A.box, { ql, timeoutMs: 200000, headers: UA })).elements
      writeFileSync(f, JSON.stringify(els)); return els
    } catch (e) { console.log(`retry  ${name}: ${e.message.slice(0, 80)}`) }
  }
  throw new Error(`${name}: OpenStreetMap did not answer`)
}

// ---- the district's boundary: every segment of its outer ways ---------------
const rel = await cachedOverpass('boundary',
  `[out:json][timeout:120];relation["ISO3166-2"="${A.iso}"]["boundary"="administrative"];out geom;`)
const segs = []
for (const m of rel[0].members) {
  if (m.type !== 'way' || m.role === 'inner' || !m.geometry) continue
  for (let i = 1; i < m.geometry.length; i++) segs.push([m.geometry[i - 1], m.geometry[i]])
}
// Ray casting over unordered segments is still exact while they close rings.
const inDistrict = (lat, lon) => {
  let c = false
  for (const [a, b] of segs) {
    if ((a.lat > lat) !== (b.lat > lat) && lon < ((b.lon - a.lon) * (lat - a.lat)) / (b.lat - a.lat) + a.lon) c = !c
  }
  return c
}

// ---- neighbourhood names, for the list ---------------------------------------
const places = (await cachedOverpass('places',
  `[out:json][timeout:120];area["ISO3166-2"="${A.iso}"]["boundary"="administrative"]->.a;` +
  `node["place"~"^(suburb|neighbourhood|quarter)$"](area.a);out body;`))
  .filter((p) => p.tags?.name).map((p) => ({ name: p.tags.name, lat: p.lat, lon: p.lon }))
const nearestPlace = (lat, lon) => {
  let best = null, bd = Infinity
  for (const p of places) { const d = (p.lat - lat) ** 2 + ((p.lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2; if (d < bd) { bd = d; best = p } }
  return best?.name ?? null
}

// ---- grid ----------------------------------------------------------------------
const mLat = 110540, mLon = 111320 * Math.cos((((S + N) / 2) * Math.PI) / 180)
const dLat = CELL_M / mLat, dLon = CELL_M / mLon
const rows = Math.ceil((N - S) / dLat), cols = Math.ceil((E - W) / dLon)
const cellOf = (lat, lon) => {
  const r = Math.floor((lat - S) / dLat), c = Math.floor((lon - W) / dLon)
  return r >= 0 && r < rows && c >= 0 && c < cols ? r * cols + c : -1
}
const px = Array.from({ length: rows * cols }, () => ({ tree: 0, shrub: 0, grass: 0, bare: 0, built: 0, water: 0, other: 0 }))
const streetM = new Float64Array(rows * cols)

// ---- canopy from WorldCover ------------------------------------------------------
const tiff = await fromFile(join(WEB, '.cache', 'worldcover', A.tile))
const img = await tiff.getImage()
const [ox, oy] = img.getOrigin()
const [rx, ry] = img.getResolution()          // ry is negative: rows go south
const x0 = Math.floor((W - ox) / rx), x1 = Math.ceil((E - ox) / rx)
const y0 = Math.floor((N - oy) / ry), y1 = Math.ceil((S - oy) / ry)
const [band] = await img.readRasters({ window: [x0, y0, x1, y1] })
const width = x1 - x0
let treePx = 0, landPx = 0
for (let i = 0; i < band.length; i++) {
  const lon = ox + (x0 + (i % width) + 0.5) * rx, lat = oy + (y0 + Math.floor(i / width) + 0.5) * ry
  const k = cellOf(lat, lon)
  if (k < 0) continue
  const v = band[i], p = px[k]
  if (v === WC.tree || v === WC.mangrove) p.tree++
  else if (v === WC.shrub) p.shrub++
  else if (v === WC.grass || v === WC.crop) p.grass++
  else if (v === WC.bare) p.bare++
  else if (v === WC.built) p.built++
  else if (v === WC.water || v === WC.wetland) p.water++
  else p.other++
}
console.log(`worldcover ${band.length.toLocaleString()} pixels read`)

// ---- streets ---------------------------------------------------------------------------
const STREET = /^(primary|secondary|tertiary|unclassified|residential|living_street|pedestrian)$/
const streets = JSON.parse(readFileSync(join(WEB, '.cache', 'green', A.green), 'utf8')).elements
  .filter((e) => e.type === 'way' && STREET.test(e.tags?.highway ?? '') && e.geometry)
for (const w of streets) {
  for (let i = 1; i < w.geometry.length; i++) {
    const a = w.geometry[i - 1], b = w.geometry[i]
    const k = cellOf((a.lat + b.lat) / 2, (a.lon + b.lon) / 2)
    if (k >= 0) streetM[k] += Math.hypot((b.lat - a.lat) * mLat, (b.lon - a.lon) * mLon)
  }
}

// ---- plan ----------------------------------------------------------------------------------
const cells = []
const tot = { missing: 0, plant: 0, onStreets: 0, onOpen: 0, treeM2: 0, landM2: 0, plantedM2: 0 }
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const lat = S + (r + 0.5) * dLat, lon = W + (c + 0.5) * dLon
  if (!inDistrict(lat, lon)) continue
  const k = r * cols + c
  // The pixel's real ground area at this cell's latitude (~81 m2 here).
  const pxM2 = pixelArea(lat)
  const plan = cellPlan(px[k], streetM[k], pxM2)
  if (!plan) continue
  treePx += px[k].tree; landPx += plan.landM2 / pxM2
  tot.treeM2 += px[k].tree * pxM2
  tot.missing += plan.missing; tot.plant += plan.plant; tot.onStreets += plan.onStreets; tot.onOpen += plan.onOpen
  tot.landM2 += plan.landM2; tot.plantedM2 += plan.plant * CROWN_M2
  cells.push({ lat: +lat.toFixed(5), lon: +lon.toFixed(5), canopy: +plan.canopy.toFixed(3), after: +plan.canopyAfter.toFixed(3),
               built: +plan.builtShare.toFixed(2), missing: plan.missing, plant: plan.plant, onStreets: plan.onStreets,
               priority: +plan.priority.toFixed(4) })
}
const canopyNow = treePx / landPx
const canopyAfter = (tot.treeM2 + tot.plantedM2) / tot.landM2
const pxMid = pixelArea((S + N) / 2)
// Ranked lists by neighbourhood: sum the cells under each nearest place name.
const byPlace = new Map()
for (const cell of cells) {
  const name = nearestPlace(cell.lat, cell.lon) ?? '—'
  const g = byPlace.get(name) ?? { name, cells: 0, canopy: 0, missing: 0, plant: 0, onStreets: 0, priority: 0, lat: 0, lon: 0 }
  g.cells++; g.canopy += cell.canopy; g.missing += cell.missing; g.plant += cell.plant; g.onStreets += cell.onStreets
  g.priority += cell.priority; g.lat += cell.lat; g.lon += cell.lon
  byPlace.set(name, g)
}
const neighbourhoods = [...byPlace.values()].map((g) => ({ ...g, canopy: +(g.canopy / g.cells).toFixed(3),
  lat: +(g.lat / g.cells).toFixed(5), lon: +(g.lon / g.cells).toFixed(5), priority: +(g.priority / g.cells).toFixed(4) }))
  .sort((a, b) => b.priority * b.plant - a.priority * a.plant)

const b = benefits(tot.plant, (canopyAfter - canopyNow) * 100)
const out = {
  slug, name: A.name, cellM: CELL_M, target: TARGET, generated: new Date().toISOString(),
  sources: ['ESA WorldCover 10 m 2021 v200 (CC-BY 4.0)', 'OpenStreetMap contributors (ODbL)'],
  totals: {
    cells: cells.length, canopyNow: +canopyNow.toFixed(3), canopyAfter: +canopyAfter.toFixed(3),
    landKm2: +(tot.landM2 / 1e6).toFixed(1), treesNow: Math.round(tot.treeM2 / CROWN_M2),
    // Two deficits, named apart (see canopy.js): every neighbourhood to 30%,
    // and the district as a whole to 30%.
    missingByCell: tot.missing, missingDistrict: districtDeficit(treePx, landPx, pxMid),
    plant: tot.plant, onStreets: tot.onStreets, onOpen: tot.onOpen,
    co2TYr: b.co2TYr.map((x) => Math.round(x)), waterM3Yr: Math.round(b.waterM3Yr),
    coolingC: b.coolingC.map((x) => +x.toFixed(2)),
  },
  neighbourhoods: neighbourhoods.slice(0, 40),
  cells,
}
writeFileSync(join(OUT, `${slug}.json`), JSON.stringify(out))
const t = out.totals
console.log(`baked  trees ${slug}: ${cells.length} cells, canopy ${(t.canopyNow * 100).toFixed(1)}% now ` +
  `(~${t.treesNow.toLocaleString()} trees, ${t.landKm2} km2 of land), every neighbourhood to 30%: ${t.missingByCell.toLocaleString()}; ` +
  `district to 30%: ${t.missingDistrict.toLocaleString()}; room to plant ` +
  `${t.plant.toLocaleString()} (${t.onStreets.toLocaleString()} on streets) -> ${(t.canopyAfter * 100).toFixed(1)}%; ` +
  `CO2 ${t.co2TYr.join('/')} t/yr, water ${t.waterM3Yr.toLocaleString()} m3/yr, cooling ${t.coolingC.join('/')} C`)
console.log('top:', out.neighbourhoods.slice(0, 6).map((n) => `${n.name} (${(n.canopy * 100).toFixed(0)}%, plant ${n.plant})`).join('; '))
