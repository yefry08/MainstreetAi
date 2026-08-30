import {
  BufferAttribute, BufferGeometry, FrontSide, MeshBasicMaterial,
} from 'three'

/**
 * Road/lane networks as a single merged ribbon mesh.
 *
 * Every edge in the network becomes a strip of quads laid flat on the ground.
 * The whole network — all 4,016 drawn edges — ends up as ONE geometry and ONE
 * draw call, with a per-vertex colour attribute we rewrite as congestion
 * changes.
 *
 * The alternative (a line primitive per edge) is a non-starter twice over:
 * WebGL ignores `lineWidth` above 1px on essentially every desktop driver, so
 * an arterial could not be drawn thicker than an alley; and thousands of
 * separate line objects means thousands of draw calls.
 *
 * Joins are deliberately unmitred. A proper mitre needs the turn angle at every
 * interior vertex and degenerates on hairpins. At the zooms this map is used
 * at, a road is a handful of pixels wide and the sliver at a bend is invisible
 * — cost that buys nothing.
 */
export function buildRibbons(features, proj, { width, z = 0.5 } = {}) {
  // Pass 1: size the buffers exactly, so we allocate once.
  let segCount = 0
  for (const f of features) segCount += Math.max(0, f.path.length - 1)

  const vertexCount = segCount * 4
  const positions = new Float32Array(vertexCount * 3)
  const colors = new Float32Array(vertexCount * 4)
  const indices =
    vertexCount > 65535
      ? new Uint32Array(segCount * 6)
      : new Uint16Array(segCount * 6)

  // [startVertex, vertexCount] per feature, so a single edge's colour can be
  // rewritten without touching the rest of the network.
  const ranges = new Int32Array(features.length * 2)

  let v = 0 // vertex cursor
  let i = 0 // index cursor

  for (let fi = 0; fi < features.length; fi++) {
    const f = features[fi]
    const w = (typeof width === 'function' ? width(f) : width) || 4
    const half = w / 2
    ranges[fi * 2] = v

    // Project the whole path once; consecutive segments share these points.
    const pts = f.path.map((c) => proj.toScene(c[0], c[1]))

    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s]
      const b = pts[s + 1]
      let dx = b.x - a.x
      let dy = b.y - a.y
      const len = Math.hypot(dx, dy)
      if (len < 1e-6) {
        // Degenerate segment (duplicated coordinate in the source data).
        // Emit a zero-area quad so the index arithmetic stays aligned.
        dx = 1
        dy = 0
      } else {
        dx /= len
        dy /= len
      }
      // Left normal in the ground plane.
      const nx = -dy * half
      const ny = dx * half

      const base = v * 3
      positions[base + 0] = a.x + nx
      positions[base + 1] = a.y + ny
      positions[base + 2] = z
      positions[base + 3] = a.x - nx
      positions[base + 4] = a.y - ny
      positions[base + 5] = z
      positions[base + 6] = b.x + nx
      positions[base + 7] = b.y + ny
      positions[base + 8] = z
      positions[base + 9] = b.x - nx
      positions[base + 10] = b.y - ny
      positions[base + 11] = z

      indices[i++] = v
      indices[i++] = v + 1
      indices[i++] = v + 2
      indices[i++] = v + 2
      indices[i++] = v + 1
      indices[i++] = v + 3

      v += 4
    }

    ranges[fi * 2 + 1] = v - ranges[fi * 2]
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  // itemSize 4 so alpha rides along with the colour; three exposes it as
  // vColor.a when the material is transparent.
  geometry.setAttribute('color', new BufferAttribute(colors, 4))
  geometry.setIndex(new BufferAttribute(indices, 1))
  geometry.computeBoundingSphere()

  return { geometry, ranges, vertexCount, segCount }
}

/** Paint one feature's vertices. Colour components are 0..1, alpha 0..1. */
export function setFeatureColor(geometry, ranges, fi, r, g, b, a) {
  const attr = geometry.getAttribute('color')
  const start = ranges[fi * 2]
  const count = ranges[fi * 2 + 1]
  const arr = attr.array
  for (let k = 0; k < count; k++) {
    const o = (start + k) * 4
    arr[o] = r
    arr[o + 1] = g
    arr[o + 2] = b
    arr[o + 3] = a
  }
}

/**
 * Unlit material. Congestion colour is data, not a surface — shading it would
 * make the same traffic state read differently depending on which way the
 * street happens to run.
 */
export function ribbonMaterial({ opacity = 1 } = {}) {
  return new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity,
    depthWrite: false, // flat ground overlay; never occlude vehicles above it
    // FrontSide, not DoubleSide: three renders a transparent double-sided
    // material in TWO passes (back faces, then front), which measured as an
    // exact 2x triangle count. These ribbons lie flat and MapLibre's 85° pitch
    // ceiling means the camera can never get beneath them, so the back faces
    // are pure waste. ribbons.test.mjs asserts every triangle winds CCW from
    // above, which is what makes this safe — get it backwards and the entire
    // road network silently vanishes.
    side: FrontSide,
  })
}
