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
 * THE TARGET is the 30 in "3-30-300" (Konijnendijk 2021, now used by cities
 * worldwide): 30% tree canopy in every neighbourhood. A cell below it has a
 * canopy DEFICIT in square metres; divided by a mature crown (CROWN_M2) that is
 * the trees MISSING.
 *
 * WHERE THEY FIT. Missing is not plantable. Each cell's ROOM is street trees
 * (one every SPACING_M along its streets, one side) plus trees on its open
 * ground (grass, shrub and bare pixels, of which OPEN_USABLE is assumed
 * plantable -- the rest is pitches, lots and verges that stay open). The trees
 * to PLANT in a cell are the smaller of missing and room, and cells are ranked
 * by heat exposure: deficit weighted by how built-up the cell is.
 *
 * BENEFITS, per tree at maturity, stated as ranges because they are averages
 * from the literature, not measurements of these trees:
 *   CO2     ~25 kg/yr sequestered (i-Tree urban averages ~15-40 kg; tropical
 *           growth is at the faster end)
 *   water   ~3.8 m3/yr of rain intercepted (i-Tree, a mature street tree)
 *   heat    ~0.5 C cooler daytime air per +10 points of canopy in a cell
 *           (studies range ~0.3-1 C; cooling grows faster above ~40% canopy)
 */

export const TARGET = 0.30
export const CROWN_M2 = 50          // ~8 m crown: a mature caoba, roble, almácigo
export const SPACING_M = 10
export const OPEN_USABLE = 0.25
export const PIXEL_M2 = 100         // WorldCover pixel, 10 m x 10 m
export const BENEFIT = {
  co2KgYr: [15, 25, 40],            // low, central, high
  waterM3Yr: 3.8,
  coolingCPer10pts: [0.3, 0.5, 1.0],
}

// ESA WorldCover classes.
export const WC = { tree: 10, shrub: 20, grass: 30, crop: 40, built: 50, bare: 60, water: 80, wetland: 90, mangrove: 95 }

/**
 * One cell from its pixel counts and street length.
 * px: {tree, shrub, grass, bare, built, water, other}; streetM: metres of street.
 */
export function cellPlan(px, streetM) {
  const land = px.tree + px.shrub + px.grass + px.bare + px.built + (px.other ?? 0)
  if (land < 20) return null                       // mostly water or outside
  const canopy = px.tree / land
  const deficitM2 = Math.max(0, TARGET * land - px.tree) * PIXEL_M2
  const missing = Math.round(deficitM2 / CROWN_M2)
  const streetRoom = Math.floor(streetM / SPACING_M)
  const openRoom = Math.floor(((px.grass + px.shrub + px.bare) * PIXEL_M2 * OPEN_USABLE) / CROWN_M2)
  const plant = Math.min(missing, streetRoom + openRoom)
  // Street trees first: they shade people, pavements and bike lanes.
  const onStreets = Math.min(plant, streetRoom)
  const builtShare = px.built / land
  const canopyAfter = Math.min(1, canopy + (plant * CROWN_M2) / (land * PIXEL_M2))
  return {
    landM2: land * PIXEL_M2, canopy, builtShare, deficitM2, missing,
    room: streetRoom + openRoom, plant, onStreets, onOpen: plant - onStreets, canopyAfter,
    // Heat priority: canopy deficit where people and asphalt are.
    priority: (deficitM2 / (land * PIXEL_M2)) * builtShare,
  }
}

/** Climate benefits of planting n trees, and cooling for a canopy gain in points. */
export function benefits(n, canopyGainPts = 0) {
  return {
    co2TYr: BENEFIT.co2KgYr.map((k) => (n * k) / 1000),
    waterM3Yr: n * BENEFIT.waterM3Yr,
    coolingC: BENEFIT.coolingCPer10pts.map((c) => (canopyGainPts / 10) * c),
  }
}

/** Trees standing now, estimated from canopy area (for comparison with the map). */
export const treesFromCanopy = (treePx) => Math.round((treePx * PIXEL_M2) / CROWN_M2)
