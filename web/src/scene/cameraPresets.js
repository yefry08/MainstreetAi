/**
 * Named camera positions for fly-to transitions.
 *
 * Coordinates are real Barcelona locations inside the simulated extract
 * (2.105–2.219 E, 41.359–41.425 N). Bearings are chosen so each corridor runs
 * across the frame rather than straight away from the camera — a street seen
 * end-on tells you nothing about how it's flowing.
 */

export const PRESETS = {
  overview: {
    label: 'City',
    hint: 'The whole simulated extract',
    center: [2.1662, 41.3925],
    zoom: 12.4,
    pitch: 50,
    bearing: -18,
  },
  eixample: {
    label: 'Eixample',
    hint: "Cerdà's grid, chamfered blocks",
    center: [2.1655, 41.3925],
    zoom: 15.1,
    pitch: 66,
    bearing: -18,
  },
  granvia: {
    label: 'Gran Via',
    hint: 'Gran Via de les Corts Catalanes',
    center: [2.1636, 41.3866],
    zoom: 15.4,
    pitch: 72,
    bearing: 38,
  },
  diagonal: {
    label: 'Diagonal',
    hint: 'Avinguda Diagonal',
    center: [2.1618, 41.3949],
    zoom: 15.3,
    pitch: 72,
    bearing: -50,
  },
  meridiana: {
    label: 'Meridiana',
    hint: 'Avinguda Meridiana toward Glòries',
    center: [2.1866, 41.4038],
    zoom: 15.2,
    pitch: 70,
    bearing: 24,
  },
  campnou: {
    label: 'Camp Nou',
    hint: 'Stadium — the concert scenario',
    center: [2.1228, 41.3809],
    zoom: 15.0,
    pitch: 62,
    bearing: 10,
  },
  sagrada: {
    label: 'Sagrada Família',
    hint: 'Heaviest tourist-traffic junction',
    center: [2.1744, 41.4036],
    zoom: 16.0,
    pitch: 70,
    bearing: -30,
  },
}

export const INITIAL = PRESETS.eixample

/**
 * Fly to a preset. Duration scales with how far we're actually travelling, so
 * a nudge across a block doesn't take as long as a jump across the city —
 * a fixed duration makes short hops feel sluggish and long hops feel frantic.
 */
export function flyToPreset(map, key, opts = {}) {
  const p = PRESETS[key]
  if (!map || !p) return
  const from = map.getCenter()
  const km = haversineKm([from.lng, from.lat], p.center)
  const duration = Math.round(Math.min(3800, Math.max(1100, 900 + km * 260)))

  map.flyTo({
    center: p.center,
    zoom: p.zoom,
    pitch: p.pitch,
    bearing: p.bearing,
    duration,
    // A gentle arc: rise, travel, descend. curve 1.5 keeps the apex low enough
    // that you never lose your sense of where you are in the city.
    curve: 1.5,
    essential: true,
    ...opts,
  })
}

/** Fly to an arbitrary point (a clicked junction), keeping the current angle. */
export function flyToPoint(map, lngLat, { zoom = 16.6, pitch, bearing } = {}) {
  if (!map) return
  map.flyTo({
    center: lngLat,
    zoom,
    pitch: pitch ?? Math.max(map.getPitch(), 60),
    bearing: bearing ?? map.getBearing(),
    duration: 1500,
    curve: 1.4,
    essential: true,
  })
}

function haversineKm(a, b) {
  const R = 6371
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLon = ((b[0] - a[0]) * Math.PI) / 180
  const la1 = (a[1] * Math.PI) / 180
  const la2 = (b[1] * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
