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
 * MIRRORS, HEDGED RATHER THAN SERIAL
 * Overpass is a free, shared, frequently overloaded service. Measured on one
 * afternoon: overpass-api.de 504 in 10 s, kumi.systems and private.coffee hung
 * past 70 s, mail.ru answered in 26 s. Trying them one after another meant a
 * visitor could wait minutes behind two dead servers before reaching the live
 * one. So the first mirror starts at once, the next joins if nothing has come
 * back within a few seconds or the current one fails, and the first usable
 * answer wins and cancels the rest.
 *
 * overpass.osm.ch WAS ON THIS LIST AND MUST NOT RETURN. It is a Switzerland-
 * only instance: it answers 200 with zero elements for anywhere else, which
 * surfaced as "empty response" for every city outside Switzerland.
 */

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

const host = (url) => new URL(url).hostname

// Drivable streets only. Service roads, tracks and footways would triple the
// node count and carry no through traffic worth simulating.
const HIGHWAY =
  '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)(_link)?$'

// How far before a junction a stop-line light is still taken to control it.
const STOP_LINE_M = 40
// Below this many mapped signalised junctions -- absolute, or as a share of all
// 3+-way junctions -- the map is treated as carrying no signal data and the
// layout is estimated instead. Istanbul's extract maps 3.
const MIN_MAPPED_SIGNALS = 5
const MIN_MAPPED_SHARE = 0.05

function query([s, w, n, e]) {
  return `[out:json][timeout:60];
(
  way["highway"~"${HIGHWAY}"]["area"!~"yes"](${s},${w},${n},${e});
  node["highway"="traffic_signals"](${s},${w},${n},${e});
);
out body geom;`
}

/**
 * Fetch the extract from whichever mirror answers first.
 *
 * `onProgress` says how many servers are in play, because a slow Overpass is
 * the single longest wait in the whole flow and a silent spinner reads as a
 * hang. `headers` exists for the Node scripts only: overpass-api.de refuses a
 * request with no User-Agent (406), which a browser always sends and Node's
 * fetch does not. Browsers ignore an attempt to set one, so the page passes
 * nothing.
 */
export function fetchCity(bbox, {
  signal, onProgress, headers = {}, hedgeMs = 6000, timeoutMs = 120000,
} = {}) {
  const body = `data=${encodeURIComponent(query(bbox))}`

  return new Promise((resolve, reject) => {
    const inflight = []
    const errors = []
    let next = 0
    let settled = false
    let hedge = null
    // Declared before finish() can run: an already-aborted signal calls it
    // synchronously, and clearing a const still in its temporal dead zone
    // would throw instead of rejecting.
    let overall = null

    const finish = (err, value) => {
      if (settled) return
      settled = true
      clearTimeout(hedge)
      clearTimeout(overall)
      signal?.removeEventListener('abort', onAbort)
      inflight.forEach((ac) => ac.abort())
      if (err) reject(err)
      else resolve(value)
    }

    const onAbort = () => finish(new DOMException('Aborted', 'AbortError'))
    if (signal?.aborted) return onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })

    overall = setTimeout(() => finish(new Error(
      `OpenStreetMap's map servers did not answer within ${timeoutMs / 1000} s ` +
      `(${errors.join('; ') || 'no reply'}). They are free and shared, and ` +
      'are sometimes overloaded — try again in a minute, or pick one of the ' +
      'ready-made cities.')), timeoutMs)

    const allFailed = () => finish(new Error(
      `Could not download this map from OpenStreetMap (${errors.join('; ')}). ` +
      'The map servers are free and shared and are sometimes overloaded — ' +
      'try again in a minute, or pick one of the ready-made cities.'))

    const launch = () => {
      if (settled || next >= MIRRORS.length) return
      const url = MIRRORS[next++]
      const ac = new AbortController()
      inflight.push(ac)
      onProgress?.(`Downloading streets (${next} of ${MIRRORS.length} map servers tried)…`)

      // If this one has not answered soon, bring in the next alongside it.
      clearTimeout(hedge)
      hedge = setTimeout(launch, hedgeMs)

      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
        body,
        signal: ac.signal,
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const json = await res.json()
          if (!json.elements?.length) throw new Error('empty response')
          finish(null, json)
        })
        .catch((e) => {
          if (settled) return
          errors.push(`${host(url)}: ${e.message}`)
          inflight.splice(inflight.indexOf(ac), 1)
          // A fast failure should not sit out the hedge delay.
          if (next < MIRRORS.length) launch()
          else if (!inflight.length) allFailed()
        })
    }

    launch()
  })
}

/**
 * READY-MADE CITIES: the same Overpass response, stored with the site.
 *
 * Live Overpass is the only way to reach an arbitrary city, and it is also the
 * least reliable thing in the page. The curated cities are fetched ahead of
 * time by scripts/bake-cities.mjs and shipped as static files, so they open
 * instantly and work while every public mirror is down.
 *
 * Only what buildGraph() reads is kept -- node ids, geometry, five tags and the
 * signal nodes -- in flat arrays. expandOsm() rebuilds the exact shape Overpass
 * returns, so the graph code has one input format and cannot drift between the
 * live path and the baked one.
 */
const KEEP_TAGS = ['highway', 'oneway', 'lanes', 'maxspeed', 'junction']

export function slimOsm(osm) {
  const ways = []
  const signals = []
  for (const el of osm.elements) {
    if (el.type === 'way' && el.geometry?.length > 1) {
      const t = {}
      for (const k of KEEP_TAGS) if (el.tags?.[k] != null) t[k] = el.tags[k]
      ways.push({
        n: el.nodes,
        // 6 dp is ~11 cm; the graph rounds coarser than that anyway.
        g: el.geometry.flatMap((p) => [+p.lat.toFixed(6), +p.lon.toFixed(6)]),
        t,
      })
    } else if (el.type === 'node' && el.tags?.highway === 'traffic_signals') {
      signals.push(el.id)
    }
  }
  return { v: 1, ways, signals }
}

export function expandOsm(slim) {
  if (slim?.v !== 1) throw new Error('Unknown ready-made city format.')
  const elements = slim.ways.map((w) => {
    const geometry = []
    for (let i = 0; i < w.g.length; i += 2) geometry.push({ lat: w.g[i], lon: w.g[i + 1] })
    return { type: 'way', nodes: w.n, geometry, tags: w.t }
  })
  for (const id of slim.signals) {
    elements.push({ type: 'node', id, tags: { highway: 'traffic_signals' } })
  }
  return { elements }
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
  if (!ways.length) throw new Error('There are no drivable streets in this area.')

  // A node touched by more than one way is a junction. Ends are always
  // junctions, so a dead end still terminates an edge.
  const touches = new Map()
  for (const way of ways) {
    for (const id of way.nodes ?? []) touches.set(id, (touches.get(id) ?? 0) + 1)
  }
  const isJunction = (id, idx, len) => idx === 0 || idx === len - 1 || (touches.get(id) ?? 0) > 1

  const nodes = new Map()          // osm id -> { id, x, y, signal, deg }
  const edges = []                 // { a, b, pts, len, oneway, lanes, speed }

  const signalIds = new Set()
  for (const el of osm.elements) {
    if (el.type === 'node' && el.tags?.highway === 'traffic_signals') signalIds.add(el.id)
  }
  // Junctions controlled by a light mapped at their STOP LINE rather than on
  // the junction node itself -- filled in while the ways are walked below.
  const stopLineJunctions = new Set()

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

      // Cumulative distance along the segment, so a stop-line light can be
      // measured against both junctions it might belong to.
      const along = [0]
      for (let k = 1; k < pts.length; k++) {
        along.push(along[k - 1] +
          Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]))
      }
      const len = along[along.length - 1]

      for (let k = 1; k < pts.length - 1; k++) {
        if (!signalIds.has(ids[startIdx + k])) continue
        const toStart = along[k]
        const toEnd = len - along[k]
        // A stop line sits just before the junction it controls. Past 40 m it
        // is more likely a mid-block pedestrian crossing, which governs no
        // junction, so it is left alone.
        if (Math.min(toStart, toEnd) > STOP_LINE_M) continue
        stopLineJunctions.add(toStart <= toEnd ? ids[startIdx] : ids[i])
      }
      // Sub-metre stubs are digitisation noise and make routing thrash.
      if (len >= 5 && a !== b) {
        edges.push({ a: a.id, b: b.id, pts, len, oneway, lanes, speed })
        a.deg++; b.deg++
      }
      startIdx = i
    }
  }

  // SIGNALS COME FROM THE MAP, AND ARE ONLY ESTIMATED WHEN THE MAP HAS NONE.
  //
  // The previous rule tagged the junction nodes OSM marks as signals and then
  // signalised every other junction of degree 3+. It read the map wrongly and
  // then papered over the gap. Much of OSM, Europe especially, maps a light at
  // its stop line a few metres before the junction, not on the junction node.
  // Measured: Madrid has 550 signal nodes and only 33 sit on a junction; the
  // graph then invented 976 more, signalising 1,009 of its 1,053 junctions.
  // That is not Madrid -- it is a city where every corner has a light, and any
  // analysis of where traffic jams, or how much retiming helps, is an analysis
  // of that fiction.
  //
  // Now: lights on the junction node count, lights at a stop line count for
  // the junction they face, and junctions with neither are left unsignalised,
  // as they are in the street. Only when the map carries almost no signals at
  // all is the old degree-3 estimate used -- and the graph says so, so the page
  // can say the layout is estimated rather than mapped.
  for (const id of signalIds) {
    const nd = nodes.get(id)
    if (nd) nd.signal = true
  }
  for (const id of stopLineJunctions) {
    const nd = nodes.get(id)
    if (nd) nd.signal = true
  }
  let tagged = 0
  for (const nd of nodes.values()) if (nd.signal) tagged++

  const crossings = [...nodes.values()].filter((nd) => nd.deg >= 3).length
  const estimated = tagged < Math.max(MIN_MAPPED_SIGNALS, crossings * MIN_MAPPED_SHARE)
  let synthetic = 0
  if (estimated) {
    for (const nd of nodes.values()) {
      if (!nd.signal && nd.deg >= 3) { nd.signal = true; synthetic++ }
    }
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
  if (!liveEdges.length) throw new Error('The streets in this area do not form a connected network.')

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
      // True when the light positions are the degree-3 estimate rather than
      // the map's. The page has to say so: it changes what the run shows.
      estimatedSignals: estimated,
      junctions: crossings,
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
