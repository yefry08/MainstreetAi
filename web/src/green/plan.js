/**
 * Green: where to plant street trees and where a bike lane would do most,
 * from OpenStreetMap, with every proposal linked to the ways behind it.
 *
 * TREES. Each street is measured against the trees mapped within TREE_M of
 * it. Streets of PLANT_MIN_M or more with under one mapped tree per 100 m are
 * planting candidates, grouped by street name and ranked by unshaded length.
 * "Room for" is one tree every SPACING_M along one side -- a conservative
 * count, since the map knows nothing of pavement width or utilities.
 *
 * BIKE LANES. The existing network is every way OSM marks for cycling
 * (cycleways, designated paths, streets with a cycle lane or track). Its
 * pieces are found by shared nodes. A street with no cycling provision that
 * touches two or more separate pieces is a CONNECTOR: building it joins them,
 * and the gain is the network it links. Main streets (primary to tertiary)
 * with no provision are listed separately, by length.
 *
 * WHAT IT IS NOT. Tree mapping in OSM ranges from complete to nearly empty
 * between cities, so a street with no mapped trees may have trees; the page
 * says so, and flags the whole area when its tree density is implausibly low.
 * Nothing here is a design: candidates are prompts for a planner to look at.
 */
import { projector } from '../transit/coverage.js'

export const TREE_M = 12
export const PLANT_MIN_M = 60
export const SPACING_M = 10
// Well-mapped centres read 34-44 trees per km of street (Rio, Barcelona); below
// this the map is very likely missing most of them. Judged in the page from
// perKm, so changing it needs no re-bake.
export const SPARSE_TREES_PER_KM = 15
const MAX_TREE_POINTS = 8000

const STREET = /^(primary|secondary|tertiary|unclassified|residential|living_street|pedestrian)$/
const MAIN = /^(primary|secondary|tertiary)$/
const BIKE_TAGS = /^(lane|track|separate|share_busway|opposite_lane|opposite_track)$/

/** Overpass query for a [south, west, north, east] box. */
export function greenQuery([s, w, n, e]) {
  const b = `${s},${w},${n},${e}`
  return `[out:json][timeout:120];
(
  way["highway"~"^(primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|cycleway)$"](${b});
  way["highway"~"^(path|footway|track)$"]["bicycle"="designated"](${b});
);
out body geom;
node["natural"="tree"](${b});
out skel;
way["natural"="tree_row"](${b});
out geom;`
}

export function isBike(tags = {}) {
  if (tags.highway === 'cycleway' || tags.bicycle === 'designated') return true
  return ['cycleway', 'cycleway:left', 'cycleway:right', 'cycleway:both']
    .some((k) => BIKE_TAGS.test(tags[k] ?? ''))
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const L = dx * dx + dy * dy
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Union-find over node ids. */
function components(ways) {
  const parent = new Map()
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) } return x }
  const add = (x) => { if (!parent.has(x)) parent.set(x, x) }
  for (const w of ways) {
    w.nodes.forEach(add)
    for (let i = 1; i < w.nodes.length; i++) {
      const a = find(w.nodes[i - 1]), b = find(w.nodes[i])
      if (a !== b) parent.set(a, b)
    }
  }
  return find
}

/**
 * Group key for streets: same name AND connected through shared nodes. Name
 * alone merged every "Calle 1a" in Santo Domingo's Distrito Nacional -- one in
 * each neighbourhood -- into a single 12.6 km "street". Unnamed ways stay apart.
 */
function streetGroups(ways) {
  const parent = new Map()
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) } return x }
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb) }
  const byNode = new Map()     // `${name}|${node}` -> first way id seen there
  for (const w of ways) {
    parent.set(w.id, w.id)
    if (!w.tags.name) continue
    for (const n of w.nodes) {
      const k = `${w.tags.name}|${n}`
      if (byNode.has(k)) union(w.id, byNode.get(k))
      else byNode.set(k, w.id)
    }
  }
  return (w) => (w.tags.name ? `${w.tags.name}|${find(w.id)}` : w.id)
}

/**
 * elements: Overpass JSON elements. centre: [lat, lon]. box: the
 * [south, west, north, east] the query used -- ways are clipped to it.
 * Returns { trees, planting, bike } -- see the module comment.
 */
export function analyseGreen(elements, centre, box = null) {
  const p = projector(centre[0], centre[1])
  const trees = []
  const ways = []
  for (const el of elements) {
    if (el.type === 'node' && el.lat != null) trees.push(p.xy(el.lat, el.lon))
    else if (el.type === 'way' && el.tags?.natural === 'tree_row' && el.geometry) {
      // A tree row stands in for a tree every 8 m along it.
      for (let i = 1; i < el.geometry.length; i++) {
        const [ax, ay] = p.xy(el.geometry[i - 1].lat, el.geometry[i - 1].lon)
        const [bx, by] = p.xy(el.geometry[i].lat, el.geometry[i].lon)
        const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 8))
        for (let k = 0; k < n; k++) trees.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n])
      }
    } else if (el.type === 'way' && el.geometry && el.tags?.highway) {
      // Overpass returns a way WHOLE, however far it runs past the box: an
      // avenue crossing the extract once read as 5.5 km of "unshaded street"
      // in a 2.5 km area. Only segments whose midpoint is inside count, for
      // length, trees and the lines drawn.
      const inside = (a, b) => {
        if (!box) return true
        const lat = (a.lat + b.lat) / 2, lon = (a.lon + b.lon) / 2
        return lat >= box[0] && lat <= box[2] && lon >= box[1] && lon <= box[3]
      }
      const ll = (g) => [Math.round(g.lon * 1e5) / 1e5, Math.round(g.lat * 1e5) / 1e5]
      const segs = []
      const lines = []
      let len = 0
      let cur = null
      for (let i = 1; i < el.geometry.length; i++) {
        const a = el.geometry[i - 1], b = el.geometry[i]
        if (!inside(a, b)) { cur = null; continue }
        const A = p.xy(a.lat, a.lon), B = p.xy(b.lat, b.lon)
        segs.push([A, B]); len += Math.hypot(B[0] - A[0], B[1] - A[1])
        if (!cur) { cur = [ll(a)]; lines.push(cur) }
        cur.push(ll(b))
      }
      if (segs.length) ways.push({ id: `way/${el.id}`, tags: el.tags, nodes: el.nodes ?? [], segs, len, lines })
    }
  }

  // ---- trees: a 20 m grid so each street checks only nearby trees ----------
  const G = 20
  const grid = new Map()
  for (const [x, y] of trees) {
    const k = `${Math.floor(x / G)},${Math.floor(y / G)}`
    if (!grid.has(k)) grid.set(k, [])
    grid.get(k).push([x, y])
  }
  const streets = ways.filter((w) => STREET.test(w.tags.highway))
  let streetM = 0
  for (const w of streets) {
    streetM += w.len
    const seen = new Set()
    for (const [[ax, ay], [bx, by]] of w.segs) {
      const x0 = Math.floor((Math.min(ax, bx) - TREE_M) / G), x1 = Math.floor((Math.max(ax, bx) + TREE_M) / G)
      const y0 = Math.floor((Math.min(ay, by) - TREE_M) / G), y1 = Math.floor((Math.max(ay, by) + TREE_M) / G)
      for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
        for (const t of grid.get(`${gx},${gy}`) ?? []) {
          if (!seen.has(t) && segDist(t[0], t[1], ax, ay, bx, by) <= TREE_M) seen.add(t)
        }
      }
    }
    w.trees = seen.size
  }
  const perKm = streetM ? trees.length / (streetM / 1000) : 0

  const plantable = streets.filter((w) => w.len >= PLANT_MIN_M && (w.trees / w.len) * 100 < 1)
  const plantKey = streetGroups(plantable)
  const byName = new Map()
  for (const w of plantable) {
    const name = w.tags.name ?? null
    const key = plantKey(w)
    const g = byName.get(key) ?? { name, lengthM: 0, ways: [], lines: [], highway: w.tags.highway }
    g.lengthM += w.len; g.ways.push(w.id); g.lines.push(...w.lines)
    byName.set(key, g)
  }
  const planting = [...byName.values()]
    .map((g) => ({ ...g, lengthM: Math.round(g.lengthM), room: Math.floor(g.lengthM / SPACING_M) }))
    .sort((a, b) => b.lengthM - a.lengthM)

  // ---- bike network ---------------------------------------------------------
  const bikeWays = ways.filter((w) => isBike(w.tags))
  const find = components(bikeWays)
  const compKm = new Map()
  for (const w of bikeWays) {
    const c = find(w.nodes[0])
    compKm.set(c, (compKm.get(c) ?? 0) + w.len / 1000)
  }
  const bikeNode = new Set(bikeWays.flatMap((w) => w.nodes))
  const connectors = []
  for (const w of streets) {
    if (isBike(w.tags)) continue
    const touched = new Set(w.nodes.filter((n) => bikeNode.has(n)).map(find))
    if (touched.size < 2) continue
    const joinsKm = [...touched].reduce((s, c) => s + compKm.get(c), 0)
    connectors.push({ id: w.id, name: w.tags.name ?? null, highway: w.tags.highway, lengthM: Math.round(w.len),
                      joins: touched.size, joinsKm: Math.round(joinsKm * 10) / 10, lines: w.lines })
  }
  // Most network joined per metre built.
  connectors.sort((a, b) => b.joinsKm / Math.max(b.lengthM, 1) - a.joinsKm / Math.max(a.lengthM, 1))

  const mains = streets.filter((w) => MAIN.test(w.tags.highway) && !isBike(w.tags))
  const mainKey = streetGroups(mains)
  const mainBy = new Map()
  for (const w of mains) {
    const key = mainKey(w)
    const g = mainBy.get(key) ?? { name: w.tags.name ?? null, highway: w.tags.highway, lengthM: 0, ways: [], lines: [] }
    g.lengthM += w.len; g.ways.push(w.id); g.lines.push(...w.lines)
    mainBy.set(key, g)
  }
  const arterials = [...mainBy.values()].filter((g) => g.lengthM >= 200)
    .map((g) => ({ ...g, lengthM: Math.round(g.lengthM) })).sort((a, b) => b.lengthM - a.lengthM)

  return {
    trees: { count: trees.length, perKm: Math.round(perKm * 10) / 10, sparse: perKm < SPARSE_TREES_PER_KM,
             streetKm: Math.round(streetM / 100) / 10,
             // For the map: every tree, capped, as [lon, lat].
             points: trees.slice(0, MAX_TREE_POINTS).map(([x, y]) => {
               const [lat, lon] = p.ll(x, y)
               return [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]
             }) },
    planting,
    bike: {
      existingKm: Math.round([...compKm.values()].reduce((s, v) => s + v, 0) * 10) / 10,
      pieces: compKm.size,
      lines: bikeWays.flatMap((w) => w.lines),
      connectors, arterials,
    },
  }
}
