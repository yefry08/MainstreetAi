import { BoxGeometry, Group, InstancedMesh, Mesh, MeshLambertMaterial } from 'three'

/**
 * A small synthetic grid city, and its three.js meshes.
 *
 * Shared by the "How it works" walkthrough and the landing page's hero, so the
 * two show the same city built the same way -- and so the landing animation is
 * a real simulation on a real graph rather than a decorative loop. Nothing here
 * needs a network or a key.
 */
export const N = 5
export const SPACING = 22

/** An N x N grid of two-lane streets; every junction of 3+ arms is signalised. */
export function makeGrid() {
  const nodes = new Map()
  const edges = []
  const id = (r, c) => r * N + c
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      nodes.set(id(r, c), { id: id(r, c), x: c * SPACING, y: r * SPACING, signal: false, deg: 0 })
    }
  }
  const link = (a, b) => {
    const A = nodes.get(a), B = nodes.get(b)
    edges.push({ a, b, pts: [[A.x, A.y], [B.x, B.y]], len: SPACING,
                 oneway: false, lanes: 2, speed: 11.1 })
    A.deg++; B.deg++
  }
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (c + 1 < N) link(id(r, c), id(r, c + 1))
      if (r + 1 < N) link(id(r, c), id(r + 1, c))
    }
  }
  const out = new Map()
  edges.forEach((e, i) => {
    if (!out.has(e.a)) out.set(e.a, [])
    if (!out.has(e.b)) out.set(e.b, [])
    out.get(e.a).push({ edge: i, to: e.b, forward: true })
    out.get(e.b).push({ edge: i, to: e.a, forward: false })
  })
  for (const nd of nodes.values()) if (nd.deg >= 3) nd.signal = true
  return { nodes, edges, out, signals: [...nodes.values()].filter((nd) => nd.signal) }
}

/** One city block: roads, blocks between them, signals, and an instanced fleet. */
export function buildBlock(grid, fleetSize, offsetX) {
  const group = new Group()
  group.position.x = offsetX

  const roadMat = new MeshLambertMaterial({ color: 0x5f6169 })
  for (const e of grid.edges) {
    const dx = e.pts[1][0] - e.pts[0][0]
    const dy = e.pts[1][1] - e.pts[0][1]
    const len = Math.hypot(dx, dy)
    const road = new Mesh(new BoxGeometry(len + 4, 1, 6), roadMat)
    road.position.set((e.pts[0][0] + e.pts[1][0]) / 2, 0.5, (e.pts[0][1] + e.pts[1][1]) / 2)
    if (Math.abs(dy) > Math.abs(dx)) road.rotation.y = Math.PI / 2
    group.add(road)
  }

  // Buildings in the blocks. Purely scenery, but without them the grid reads as
  // a wireframe rather than a city, and depth is the reason for using 3D here.
  const buildMat = new MeshLambertMaterial({ color: 0xc9c2b4 })
  for (let r = 0; r < N - 1; r++) {
    for (let c = 0; c < N - 1; c++) {
      const h = 4 + ((r * 7 + c * 13) % 5) * 3
      const b = new Mesh(new BoxGeometry(11, h, 11), buildMat)
      b.position.set(c * SPACING + SPACING / 2, h / 2, r * SPACING + SPACING / 2)
      group.add(b)
    }
  }

  const signalMeshes = grid.signals.map((nd) => {
    const m = new Mesh(new BoxGeometry(1.6, 5, 1.6),
                       new MeshLambertMaterial({ color: 0x3fb34f, emissive: 0x1a4a20 }))
    m.position.set(nd.x, 3, nd.y)
    group.add(m)
    return m
  })

  const cars = new InstancedMesh(
    new BoxGeometry(3.4, 1.8, 2.2),
    new MeshLambertMaterial({ color: 0xffffff }),
    fleetSize,
  )
  cars.frustumCulled = false
  group.add(cars)

  return { group, cars, signalMeshes }
}
