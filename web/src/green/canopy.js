/**
 * Tree canopy: how many trees are missing, how many to plant, where, and what
 * they would do for the climate.
 *
 * MEASURED, NOT MAPPED. OpenStreetMap holds ~460 trees for the whole Distrito
 * Nacional, so "trees on the map" says nothing about trees on the ground.
 * Canopy here comes from ESA WorldCover 2021: a global 10 m satellite land
 * cover map, class 10 = tree cover. Every 250 m cell of the district gets its
 * real canopy share.
 *
 * PIXEL AREA IS NOT 100 m2. WorldCover pixels are 1/12000 degree, so their
 * ground area shrinks with latitude: ~81 m2 at Santo Domingo (18.5 N). An
 * external audit (2026-11-09) found the first version using 100 m2, which
 * inflated the trees standing (+23%) and the land area; every area here now
 * takes the pixel's real area for its latitude (pixelM2).
 *
 * THE TARGET is the 30 in "3-30-300" (Konijnendijk 2021): 30% tree canopy in
 * every neighbourhood. Two different numbers follow from it, named apart:
 *   deficit by cell   -- trees each cell under 30% lacks, summed. Cells above
 *                        30% do not offset the ones below: the neighbourhood
 *                        target.
 *   district deficit  -- trees for the district AS A WHOLE to reach 30%.
 *                        Smaller, because leafy cells count.
 *
 * WHERE THEY FIT. Each cell's ROOM is street trees -- one every SPACING_M along
 * STREET_FEASIBLE of its street length (narrow pavements, overhead cables,
 * driveways and corners take the rest; an assumption until pavement and
 * utility data exist) -- plus trees on OPEN_USABLE of its open ground (grass,
 * shrub, bare pixels). The trees to PLANT are the smaller of the cell's deficit
 * and its room; cells are ranked by deficit weighted by how built-up they are,
 * a heat PROXY until land-surface temperature is used.
 *
 * BENEFITS, per tree AT MATURITY (10-20 years), as ranges from the literature,
 * not measurements of these trees, and before mortality:
 *   CO2     15-40 kg/yr sequestered (i-Tree urban averages; central 25)
 *   water   ~3.8 m3/yr of rain intercepted (i-Tree, a mature street tree)
 *   heat    0.3-1 C cooler daytime air per +10 points of canopy in a cell
 */

export const TARGET = 0.30
export const CROWN_M2 = 50          // ~8 m crown: a mature caoba, roble, almácigo
export const SPACING_M = 10
export const STREET_FEASIBLE = 0.5
export const OPEN_USABLE = 0.25
export const BENEFIT = {
  co2KgYr: [15, 25, 40],            // low, central, high
  waterM3Yr: 3.8,
  coolingCPer10pts: [0.3, 0.5, 1.0],
}

/** Ground area of a WorldCover (1/12000 degree) pixel at a latitude, in m2. */
export const pixelArea = (lat, deg = 1 / 12000) =>
  deg * 111320 * Math.cos((lat * Math.PI) / 180) * deg * 110540

// ESA WorldCover classes.
export const WC = { tree: 10, shrub: 20, grass: 30, crop: 40, built: 50, bare: 60, water: 80, wetland: 90, mangrove: 95 }

/**
 * One cell from its pixel counts and street length.
 * px: {tree, shrub, grass, bare, built, water, other}; streetM: metres of
 * street; pixelM2: the pixel's ground area at this latitude.
 */
export function cellPlan(px, streetM, pixelM2 = pixelArea(18.5)) {
  const land = px.tree + px.shrub + px.grass + px.bare + px.built + (px.other ?? 0)
  if (land < 20) return null                       // mostly water or outside
  const landM2 = land * pixelM2
  const canopy = px.tree / land
  const deficitM2 = Math.max(0, TARGET * land - px.tree) * pixelM2
  const missing = Math.round(deficitM2 / CROWN_M2)
  // A street already under canopy has no room for more: scale by the open share.
  const streetRoom = Math.floor(((streetM * STREET_FEASIBLE) / SPACING_M) * (1 - canopy))
  const openRoom = Math.floor(((px.grass + px.shrub + px.bare) * pixelM2 * OPEN_USABLE) / CROWN_M2)
  const plant = Math.min(missing, streetRoom + openRoom)
  // Street trees first: they shade people, pavements and bike lanes.
  const onStreets = Math.min(plant, streetRoom)
  const builtShare = px.built / land
  const canopyAfter = Math.min(1, canopy + (plant * CROWN_M2) / landM2)
  return {
    landM2, canopy, builtShare, deficitM2, missing,
    room: streetRoom + openRoom, plant, onStreets, onOpen: plant - onStreets, canopyAfter,
    // Heat priority PROXY: canopy deficit where asphalt and roofs are.
    priority: (deficitM2 / landM2) * builtShare,
  }
}

/** Climate benefits of n mature trees, and cooling for a canopy gain in points. */
export function benefits(n, canopyGainPts = 0) {
  return {
    co2TYr: BENEFIT.co2KgYr.map((k) => (n * k) / 1000),
    waterM3Yr: n * BENEFIT.waterM3Yr,
    coolingC: BENEFIT.coolingCPer10pts.map((c) => (canopyGainPts / 10) * c),
  }
}

/** Trees standing now, estimated from canopy area. */
export const treesFromCanopy = (treePx, pixelM2 = pixelArea(18.5)) => Math.round((treePx * pixelM2) / CROWN_M2)

/** Trees for a whole area to reach TARGET: the aggregate, not the per-cell sum. */
export const districtDeficit = (treePx, landPx, pixelM2) =>
  Math.max(0, Math.round(((TARGET * landPx - treePx) * pixelM2) / CROWN_M2))
