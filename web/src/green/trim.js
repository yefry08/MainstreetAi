/**
 * Cap the Green analysis to what the page shows, so a baked file stays small
 * and a live one renders quickly. Totals (counts, km) are computed before the
 * cap, so they still describe the whole area.
 */
export const SHOW = { planting: 40, connectors: 40, arterials: 30 }

export function trimGreen(r) {
  return {
    ...r,
    planting: r.planting.slice(0, SHOW.planting),
    plantingTotal: { streets: r.planting.length, room: r.planting.reduce((s, x) => s + x.room, 0),
                     km: Math.round(r.planting.reduce((s, x) => s + x.lengthM, 0) / 100) / 10 },
    bike: {
      ...r.bike,
      connectors: r.bike.connectors.slice(0, SHOW.connectors),
      arterials: r.bike.arterials.slice(0, SHOW.arterials),
      connectorsTotal: r.bike.connectors.length,
      arterialsKm: Math.round(r.bike.arterials.reduce((s, x) => s + x.lengthM, 0) / 100) / 10,
    },
  }
}
