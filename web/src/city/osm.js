/**
 * Street network for an arbitrary city, fetched and graphed in the browser.
 *
 * This is where the map actually comes from. No model invents it: Overpass
 * returns the real ways and nodes of the chosen extract, under ODbL, and the
 * graph below is built from that geometry. The AI's job is the palette and the
 * signal policy, not the city.
 *
 * WHAT COMES BACK AND WHAT IS KEPT
 * Overpass returns ways with a node list, plus every node's coordinates. A way
 * is a street; the junctions are the nodes that more than one way touches.
 * Interior nodes only shape the line, so they are kept as geometry and dropped
 * as graph vertices -- otherwise a straight road becomes forty junctions and
 * the simulation spends its time at imaginary intersections.
 *
 * MIRRORS AND TIMEOUTS
 * Overpass is a free, shared, frequently busy service. One mirror will refuse
 * or stall often enough that a single-endpoint client feels broken, so the
 * three public mirrors are tried in turn and the query carries its own server
 * side timeout.
 */

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
]

// Drivable streets only. Service roads, tracks and footways would triple the
// node count and carry no through traffic worth simulating.
const HIGHWAY =
  '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)(_link)?$'

function query([s, w, n, e]) {
  return `[out:json][timeout:60];
(
  way["highway"~"${HIGHWAY}"]["area"!~"yes"](${s},${w},${n},${e});
  node["highway"="traffic_signals"](${s},${w},${n},${e});
);
out body geom;`
}

/**
 * Fetch the extract. `onProgress` reports which mirror is being tried, because
 * a slow Overpass is the single longest wait in the whole flow and a silent
 * spinner during it reads as a hang.
 */
export async function fetchCity(bbox, { signal, onProgress } = {}) {
  let lastErr = null
  for (let i = 0; i < MIRRORS.length; i++) {
    onProgress?.(`Descargando calles (servidor ${i + 1}/${MIRRORS.length})…`)
    try {
      const res = await fetch(MIRRORS[i], {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query(bbox))}`,
        signal,
      })
      if (!res.ok) { lastErr = `HTTP ${res.status}`; continue }
      const json = await res.json()
      if (!json.elements?.length) { lastErr = 'respuesta vacía'; continue }
      return json
    } catch (e) {
      if (e.name === 'AbortError') throw e
      lastErr = e.message
    }
  }
  throw new Error(`No se pudo descargar el mapa de OpenStreetMap (${lastErr}). ` +
                  'Overpass es un servicio gratuito y a veces está saturado; ' +
                  'espera un momento y reinténtalo.')
}

/**
 * Turn the Overpass response into a routable graph.
 *
 * Returns nodes in local metres (east/north from the extract centre), edges
 * with their polyline geometry, and the junctions that carry a signal.
 */
export function buildGraph(osm, bbox) {
  const [s, w, n, e] = bbox
  const lat0 = (s + n) / 2
  const lon0 = (w + e) / 2
  const mPerLat = 111320
  const mPerLon = 111320 * Math.cos((lat0 * Math.PI) / 180)
  const toXY = (lat, lon) => [(lon - lon0) * mPerLon, (lat - lat0) * mPerLat]

  const ways = osm.elements.filter((el) => el.type === 'way' && el.geometry?.length > 1)
  if (!ways.length) throw new Error('El extracto no contiene calles utilizables.')

  // A node touched by more than one way is a junction. Ends are always
  // junctions, so a dead end still terminates an edge.
  const touches = new Map()
  for (const way of ways) {
    for (const id of way.nodes ?? []) touches.set(id, (touches.get(id) ?? 0) + 1)
  }
  const isJunction = (id, idx, len) => idx === 0 || idx === len - 1 || (touches.get(id) ?? 0) > 1

  const nodes = new Map()          // osm id -> { id, x, y, signal, deg }
  const edges = []                 // { a, b, pts, len, oneway, lanes, speed }

  const addNode = (osmId, lat, lon) => {
    if (!nodes.has(osmId)) {
      const [x, y] = toXY(lat, lon)
      nodes.set(osmId, { id: osmId, x, y, signal: false, deg: 0 })
    }
    return nodes.get(osmId)
  }

  for (const way of ways) {
    const ids = way.nodes ?? []
    const geom = way.geometry
    if (ids.length !== geom.length) continue      // malformed, skip rather than guess

    const oneway = way.tags?.oneway === 'yes' || way.tags?.junction === 'roundabout'
    const lanes = Math.max(1, parseInt(way.tags?.lanes, 10) || 1)
    const speed = speedOf(way.tags)

    let startIdx = 0
    for (let i = 1; i < ids.length; i++) {
      if (!isJunction(ids[i], i, ids.length)) continue

      const a = addNode(ids[startIdx], geom[startIdx].lat, geom[startIdx].lon)
      const b = addNode(ids[i], geom[i].lat, geom[i].lon)
      const pts = geom.slice(startIdx, i + 1).map((g) => toXY(g.lat, g.lon))

      let len = 0
      for (let k = 1; k < pts.length; k++) {
        len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])
      }
      // Sub-metre stubs are digitisation noise and make routing thrash.
      if (len >= 5 && a !== b) {
        edges.push({ a: a.id, b: b.id, pts, len, oneway, lanes, speed })
        a.deg++; b.deg++
      }
      startIdx = i
    }
  }

  // Signals from OSM where they exist. Many extracts tag few or none, so a
  // junction of degree >= 3 without one is signalised synthetically -- and the
  // UI says which, because "this city has no traffic lights" would be a claim
  // about the city rather than about its map data.
  let tagged = 0
  for (const el of osm.elements) {
    if (el.type === 'node' && el.tags?.highway === 'traffic_signals') {
      const nd = nodes.get(el.id)
      if (nd) { nd.signal = true; tagged++ }
    }
  }
  let synthetic = 0
  for (const nd of nodes.values()) {
    if (!nd.signal && nd.deg >= 3) { nd.signal = true; synthetic++ }
  }

  // Adjacency is built TWICE, and that is deliberate.
  //
  // The first pass only exists to find the largest connected component. Once
  // the islands are dropped the edge array is shorter, so every index in that
  // first adjacency now points at the wrong edge -- or past the end of the
  // array. The simulation reads those indices to move vehicles, so a stale one
  // is either a crash or, worse, a vehicle silently teleporting onto an
  // unrelated street.
  //
  // A synthetic test grid never catches this: it is fully connected, nothing
  // is filtered, and the indices happen to line up. Real OSM extracts always
  // have islands.
  const buildAdjacency = (list) => {
    const adj = new Map()
    list.forEach((edge, i) => {
      if (!adj.has(edge.a)) adj.set(edge.a, [])
      adj.get(edge.a).push({ edge: i, to: edge.b, forward: true })
      if (!edge.oneway) {
        if (!adj.has(edge.b)) adj.set(edge.b, [])
        adj.get(edge.b).push({ edge: i, to: edge.a, forward: false })
      }
    })
    return adj
  }

  // Anything unreachable would strand vehicles, so keep the largest connected
  // component and drop the islands.
  const keep = largestComponent(buildAdjacency(edges), nodes)
  const liveEdges = edges.filter((e) => keep.has(e.a) && keep.has(e.b))
  if (!liveEdges.length) throw new Error('El extracto no tiene una red conectada.')

  // Rebuilt against the filtered list, so every index is valid again.
  const out = buildAdjacency(liveEdges)

  const signals = [...nodes.values()]
    .filter((nd) => nd.signal && keep.has(nd.id) && out.has(nd.id))

  return {
    nodes, edges: liveEdges, out, signals,
    stats: {
      nodes: keep.size,
      edges: liveEdges.length,
      signals: signals.length,
      taggedSignals: tagged,
      syntheticSignals: synthetic,
      km: liveEdges.reduce((s2, e2) => s2 + e2.len * e2.lanes, 0) / 1000,
    },
    centre: [lon0, lat0],
    mPerLon, mPerLat,
  }
}

function speedOf(tags) {
  const raw = tags?.maxspeed
  const parsed = parseInt(raw, 10)
  if (parsed > 0) return (/mph/.test(raw) ? parsed * 1.609 : parsed) / 3.6
  return ({ motorway: 27.8, trunk: 22.2, primary: 16.7, secondary: 13.9,
            tertiary: 12.5, residential: 8.3, living_street: 5.6 }[tags?.highway] ?? 11.1)
}

/** Breadth-first sweep from the highest-degree node. */
function largestComponent(out, nodes) {
  const seen = new Set()
  let best = new Set()
  const all = [...nodes.values()].sort((a, b) => b.deg - a.deg)
  for (const start of all) {
    if (seen.has(start.id)) continue
    const comp = new Set([start.id])
    const stack = [start.id]
    while (stack.length) {
      const cur = stack.pop()
      for (const link of out.get(cur) ?? []) {
        if (!comp.has(link.to)) { comp.add(link.to); stack.push(link.to) }
      }
    }
    comp.forEach((id) => seen.add(id))
    if (comp.size > best.size) best = comp
    if (best.size > nodes.size / 2) break        // nothing left can beat it
  }
  return best
}
