/**
 * Find a district's traffic generators in OpenStreetMap and tie each to the
 * signalised junctions its trips will cross.
 *
 *   node scripts/bake-predict.mjs santo_domingo
 *
 * Output: public/predict/<district>.json -- generators (kind, name, people,
 * position, nearby signals with weights) and the signals themselves. The page
 * turns these into hour-by-hour predictions with src/predict/generators.js and
 * the live rain forecast; sim/build_events.py turns them into SUMO demand.
 *
 * Signals come from the district's own SUMO export
 * (public/data/signals_<district>.geojson), so a prediction names exactly the
 * junctions the twin's AI controls.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchCity } from '../src/city/osm.js'
import { kindOf, peopleAt } from '../src/predict/generators.js'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(WEB, 'public', 'predict')
const CACHE = join(WEB, '.cache', 'predict')
mkdirSync(OUT, { recursive: true }); mkdirSync(CACHE, { recursive: true })

const DISTRICTS = {
  santo_domingo: { name: 'Santo Domingo — Distrito Nacional', iso: 'DO-01', box: [18.415, -70.005, 18.535, -69.870],
                   centre: [18.4745, -69.9395] },
}
// A junction further than this from a generator is not where its queue forms.
const REACH_M = 700
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000))

const query = (iso, [s, w, n, e]) => `[out:json][timeout:180];
area["ISO3166-2"="${iso}"]["boundary"="administrative"]->.a;
(
  nwr["amenity"~"^(school|kindergarten|university|college|hospital|clinic|place_of_worship)$"](area.a)(${s},${w},${n},${e});
  nwr["shop"~"^(mall|department_store|supermarket)$"](area.a)(${s},${w},${n},${e});
  nwr["leisure"="stadium"](area.a)(${s},${w},${n},${e});
  nwr["office"](area.a)(${s},${w},${n},${e});
  way["building"="office"](area.a)(${s},${w},${n},${e});
);
out tags geom;`

function tiles([s, w, n, e]) {
  const ms = (s + n) / 2, mw = (w + e) / 2
  return [[s, w, ms, mw], [s, mw, ms, e], [ms, w, n, mw], [ms, mw, n, e]]
}

const R = 6371000
const metres = (a, b) => {
  const toR = (d) => (d * Math.PI) / 180
  const x = toR(b[1] - a[1]) * Math.cos(toR((a[0] + b[0]) / 2)), y = toR(b[0] - a[0])
  return Math.hypot(x, y) * R
}

/** Polygon area in m2 and centroid from Overpass geometry. */
function shape(geom) {
  const lat0 = geom[0].lat
  const k = 111320 * Math.cos((lat0 * Math.PI) / 180)
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i < geom.length - 1; i++) {
    const x0 = geom[i].lon * k, y0 = geom[i].lat * 110540, x1 = geom[i + 1].lon * k, y1 = geom[i + 1].lat * 110540
    const c = x0 * y1 - x1 * y0
    a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c
  }
  if (Math.abs(a) < 1e-6) return { area: 0, lat: geom[0].lat, lon: geom[0].lon }
  return { area: Math.abs(a) / 2, lon: cx / (3 * a) / k, lat: cy / (3 * a) / 110540 }
}

for (const key of process.argv.slice(2)) {
  const d = DISTRICTS[key]
  if (!d) { console.log(`skip   ${key}`); continue }
  const cached = join(CACHE, `${key}.json`)
  let elements = existsSync(cached) ? JSON.parse(readFileSync(cached, 'utf8')) : null
  if (!elements) {
    const seen = new Map()
    for (const [i, t] of tiles(d.box).entries()) {
      let got = null
      for (const pause of [0, 30, 90, 180]) {
        if (pause) await sleep(pause)
        try { got = await fetchCity(t, { ql: query(d.iso, t), timeoutMs: 240000,
          headers: { 'User-Agent': 'mainstreetai-bake/1.0 (github.com/yefry08/MainstreetAi)' } }); break }
        catch (e) { console.log(`retry  tile ${i + 1}/4: ${e.message.slice(0, 90)}`) }
      }
      if (!got) { console.log(`FAIL   ${key} tile ${i + 1}`); process.exit(1) }
      for (const el of got.elements) seen.set(`${el.type}/${el.id}`, el)
      console.log(`  tile ${i + 1}/4: ${got.elements.length} places`)
    }
    elements = [...seen.values()]
    writeFileSync(cached, JSON.stringify(elements))
  }

  const sig = JSON.parse(readFileSync(join(WEB, 'public', 'data', `signals_${key}.geojson`), 'utf8'))
  const signals = sig.features.map((f, i) => ({ i, id: f.properties?.id ?? String(i),
    lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], name: f.properties?.label ?? f.properties?.name ?? null }))

  const gens = []
  for (const el of elements) {
    const kind = kindOf(el.tags)
    if (!kind) continue
    let pos = { lat: el.lat, lon: el.lon, area: 0 }
    if (el.type === 'way' && el.geometry?.length > 2) pos = shape(el.geometry)
    else if (el.type === 'relation' && el.bounds) pos = { lat: (el.bounds.minlat + el.bounds.maxlat) / 2, lon: (el.bounds.minlon + el.bounds.maxlon) / 2, area: 0 }
    if (pos.lat == null) continue
    // Inverse-distance weights over the signals within reach: the junctions a
    // generator's cars actually queue at.
    const near = signals.map((s) => [s.i, metres([pos.lat, pos.lon], [s.lat, s.lon])])
      .filter(([, m]) => m <= REACH_M).sort((a, b) => a[1] - b[1]).slice(0, 4)
    const wsum = near.reduce((s, [, m]) => s + 1 / Math.max(m, 50), 0)
    gens.push({
      id: `${el.type}/${el.id}`, kind, name: el.tags.name ?? null,
      lat: Math.round(pos.lat * 1e5) / 1e5, lon: Math.round(pos.lon * 1e5) / 1e5,
      people: peopleAt(kind, el.tags, pos.area),
      signals: near.map(([i, m]) => [i, Math.round(((1 / Math.max(m, 50)) / wsum) * 1000) / 1000]),
    })
  }
  const byKind = {}
  for (const g of gens) byKind[g.kind] = (byKind[g.kind] ?? 0) + 1
  writeFileSync(join(OUT, `${key}.json`), JSON.stringify({
    district: key, name: d.name, centre: d.centre, generated: new Date().toISOString(),
    source: 'OpenStreetMap contributors (ODbL), via Overpass', reachM: REACH_M, signals, generators: gens,
  }))
  console.log(`baked  ${key}: ${gens.length} generators ${JSON.stringify(byKind)}; ` +
              `${gens.filter((g) => g.signals.length).length} near a signal; ${signals.length} signals`)
}
