import * as THREE from 'three'

/**
 * Procedural low-poly vehicle geometry.
 *
 * Built from primitives rather than loaded as glTF on purpose: no CDN, no
 * licences, no missing-asset risk on stage, and the silhouettes are tuned for
 * the one thing that matters here — being identifiable at city zoom, where a
 * car is a handful of pixels. Detail that only resolves at street level would
 * cost triangles for nothing.
 *
 * CONVENTION, and it matters: every mesh is built with its LENGTH ALONG +Y.
 * Scene space is x=east, y=north, z=up, so +Y is heading 0 (due north), which
 * is what SUMO reports as angle 0. A vehicle at heading θ (degrees clockwise
 * from north) is then just a rotation of -θ about Z.
 *
 * Everything sits with its base at z=0 so instances can be placed directly on
 * the road surface without per-type offsets.
 */

/** Merge a set of boxes into one BufferGeometry. */
function boxes(specs) {
  const geoms = specs.map(({ size, at }) => {
    const g = new THREE.BoxGeometry(size[0], size[1], size[2])
    g.translate(at[0], at[1], at[2])
    return g
  })
  const merged = mergeGeometries(geoms)
  geoms.forEach((g) => g.dispose())
  return merged
}

/**
 * Minimal geometry merge. three's BufferGeometryUtils lives in the examples
 * folder, which pulls a second copy of three into the bundle under some
 * resolvers; these are all simple non-indexed-after-toNonIndexed boxes, so
 * merging them is a concat.
 */
function mergeGeometries(geoms) {
  const plain = geoms.map((g) => g.toNonIndexed())
  let total = 0
  for (const g of plain) total += g.getAttribute('position').count

  const position = new Float32Array(total * 3)
  const normal = new Float32Array(total * 3)
  let o = 0
  for (const g of plain) {
    const p = g.getAttribute('position').array
    const n = g.getAttribute('normal').array
    position.set(p, o * 3)
    normal.set(n, o * 3)
    o += g.getAttribute('position').count
    g.dispose()
  }

  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(position, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
  out.computeBoundingSphere()
  return out
}

/**
 * Car: 4.3 x 1.85 m, cabin set back and narrower than the body.
 * The stepped roofline is what separates it from the bus at a glance — at
 * this scale you read proportion and silhouette, never detail.
 */
export function carGeometry() {
  return boxes([
    { size: [1.85, 4.3, 0.72], at: [0, 0, 0.36] },      // body
    { size: [1.62, 2.25, 0.62], at: [0, -0.12, 1.03] },  // cabin
  ])
}

/**
 * Bus: 18 m articulated, the standard on Barcelona's high-demand orthogonal
 * lines. Split into two segments with a visible gap at the joint, because the
 * articulation is the giveaway that reads even when the bus is 8 px long.
 */
export function busGeometry() {
  return boxes([
    { size: [2.55, 9.6, 2.9], at: [0, 4.0, 1.55] },   // front segment
    { size: [2.2, 1.1, 2.6], at: [0, -1.05, 1.5] },   // articulation
    { size: [2.55, 7.4, 2.9], at: [0, -5.3, 1.55] },  // rear segment
  ])
}

/**
 * The bus's lit windows, as a separate mesh so it can carry an emissive
 * material. Buses are the only thing on the street that glows from inside at
 * night, which is both true and the whole argument of the project — transit
 * priority made visible without a label.
 */
export function busWindowGeometry() {
  return boxes([
    { size: [2.62, 8.4, 0.78], at: [0, 4.0, 2.05] },
    { size: [2.62, 6.4, 0.78], at: [0, -5.3, 2.05] },
  ])
}

/**
 * Bicycle: an upright sliver. No attempt at a frame — at any zoom where a
 * bicycle is visible at all, it is two or three pixels, and the useful signal
 * is "narrow, short, moving in the bike lane".
 */
export function bikeGeometry() {
  return boxes([
    { size: [0.42, 1.65, 0.36], at: [0, 0, 0.42] },  // frame mass
    { size: [0.38, 0.42, 0.78], at: [0, -0.15, 1.0] }, // rider
  ])
}

/**
 * Delivery van / rigid truck: a tall box body with a shorter, set-forward cab.
 *
 * The tall slab-sided silhouette is the whole identification cue. At the zooms
 * this map is used at you cannot see a windscreen, but you can see that
 * something is twice as tall as the cars around it and doesn't taper.
 */
export function truckGeometry() {
  return boxes([
    { size: [2.3, 5.6, 2.5], at: [0, -1.1, 1.45] },  // box body
    { size: [2.15, 2.3, 1.75], at: [0, 2.85, 1.0] },  // cab
  ])
}

/**
 * Motorcycle: rider mass over a short, narrow chassis.
 *
 * Barcelona's most characteristic vehicle, so it needs to be identifiable
 * rather than just small — the giveaway at distance is being NARROW while
 * moving as fast as the cars, which is exactly what a scooter filtering
 * through traffic looks like from above.
 */
export function motoGeometry() {
  return boxes([
    { size: [0.52, 1.95, 0.5], at: [0, 0, 0.42] },     // chassis
    { size: [0.5, 0.6, 0.85], at: [0, -0.25, 1.02] },  // rider
  ])
}

/**
 * Materials.
 *
 * Flat-ish shading with low roughness variance: these are tiny objects against
 * a dark city and the eye needs to separate them by HUE and BRIGHTNESS, not by
 * specular detail it will never resolve.
 */
export function vehicleMaterial(color, { emissive = 0x000000, emissiveIntensity = 0 } = {}) {
  return new THREE.MeshLambertMaterial({
    color,
    emissive,
    emissiveIntensity,
  })
}

/** Emissive material for the bus windows — unlit, so it reads at any distance. */
export function glowMaterial(color) {
  return new THREE.MeshBasicMaterial({ color, toneMapped: false })
}
