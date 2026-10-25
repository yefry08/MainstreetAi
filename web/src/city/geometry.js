/**
 * Where a vehicle is, given its edge and how far along it it has driven.
 *
 * Shared by the 2D canvas and the 3D city so both draw every vehicle in
 * exactly the same place -- one function, so the two views cannot disagree.
 */

/** The point `d` metres along the edge's polyline, and the heading there (radians, x east, y north). */
export function pointOnEdge(e, d) {
  let acc = 0
  for (let i = 1; i < e.pts.length; i++) {
    const [x0, y0] = e.pts[i - 1]
    const [x1, y1] = e.pts[i]
    const seg = Math.hypot(x1 - x0, y1 - y0)
    if (acc + seg >= d) {
      const f = seg > 0 ? (d - acc) / seg : 0
      return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, Math.atan2(y1 - y0, x1 - x0)]
    }
    acc += seg
  }
  const n = e.pts.length
  const [xa, ya] = e.pts[n - 2] ?? e.pts[0]
  const [xb, yb] = e.pts[n - 1]
  return [xb, yb, Math.atan2(yb - ya, xb - xa)]
}

/** A vehicle's position and the direction it is driving. */
export function vehiclePose(edges, v) {
  const e = edges[v.edge]
  if (!e) return null
  const along = v.fwd ? v.pos : e.len - v.pos
  const [x, y, h] = pointOnEdge(e, along)
  // Driving against the polyline's direction faces the other way.
  return [x, y, v.fwd ? h : h + Math.PI]
}

/** Local metres (graph space) -> [lng, lat]. Inverse of buildGraph's projection. */
export const toLngLat = (graph, x, y) =>
  [graph.centre[0] + x / graph.mPerLon, graph.centre[1] + y / graph.mPerLat]
