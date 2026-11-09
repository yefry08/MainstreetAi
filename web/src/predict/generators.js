/**
 * Traffic generators: the places that make congestion predictable.
 *
 * Adaptive signals react to queues that have already formed. Orchestrating
 * traffic means knowing they are coming: a private school lets out at 13:00 and
 * hundreds of parents drive to its gate; offices empty at 17:00; a game at the
 * Estadio Quisqueya fills the avenues at 18:30; rain puts more people in cars.
 * This module turns OpenStreetMap places into generators with time profiles,
 * and predicts the extra car trips each one adds, hour by hour.
 *
 * EVERY PROFILE HERE IS AN ASSUMPTION, NOT A MEASUREMENT. Times, sizes and car
 * shares are informed estimates for Santo Domingo, written out so a planner
 * can see and replace them -- with a school's real enrolment and timetable, a
 * traffic count, a stadium's schedule. The page labels them as such.
 */

/** Kinds, with when and how hard each pulls cars. Windows are [start, end) in hours. */
export const KINDS = {
  school_private: {
    label: ['Private school', 'Colegio privado'],
    // Parents drive: a car per ~1.6 pupils at the gate, both ways.
    people: 450, carShare: 0.62,
    windows: [{ in: [6.75, 7.75], share: 1 }, { out: [12.5, 14.0], share: 0.7 }, { out: [16.0, 17.0], share: 0.3 }],
    days: 'weekdays',
  },
  school_public: {
    label: ['Public school', 'Escuela pública'],
    people: 700, carShare: 0.08,
    windows: [{ in: [7.5, 8.0], share: 1 }, { out: [12.0, 12.5], share: 0.5 }, { out: [17.5, 18.0], share: 0.5 }],
    days: 'weekdays',
  },
  university: {
    label: ['University', 'Universidad'],
    people: 2500, carShare: 0.35,
    windows: [{ in: [7.0, 8.0], share: 0.5 }, { in: [17.0, 18.0], share: 0.5 }, { out: [12.0, 13.0], share: 0.4 }, { out: [21.0, 22.0], share: 0.6 }],
    days: 'weekdays',
  },
  office: {
    label: ['Offices', 'Oficinas'],
    people: 120, carShare: 0.55,
    windows: [{ in: [7.5, 8.75], share: 1 }, { out: [17.0, 18.5], share: 1 }],
    days: 'weekdays',
  },
  mall: {
    label: ['Shopping centre', 'Centro comercial'],
    people: 3000, carShare: 0.6,
    windows: [{ in: [17.5, 19.5], share: 0.6 }, { out: [20.0, 22.0], share: 0.6 }, { in: [11.0, 13.0], share: 0.3 }],
    days: 'all',
  },
  supermarket: {
    label: ['Supermarket', 'Supermercado'],
    people: 400, carShare: 0.6,
    windows: [{ in: [17.0, 20.0], share: 0.7 }, { out: [17.5, 20.5], share: 0.7 }],
    days: 'all',
  },
  hospital: {
    label: ['Hospital / clinic', 'Hospital / clínica'],
    people: 600, carShare: 0.45,
    windows: [{ in: [6.5, 7.5], share: 0.6 }, { out: [7.0, 8.0], share: 0.4 }, { in: [18.5, 19.5], share: 0.4 }, { out: [19.0, 20.0], share: 0.6 }],
    days: 'all',
  },
  stadium: {
    label: ['Stadium (game day)', 'Estadio (día de partido)'],
    // Only on an event day: see EVENTS. 10,000 fans, most arriving by car or taxi.
    people: 10000, carShare: 0.45,
    windows: [{ in: [17.5, 19.0], share: 1 }, { out: [22.0, 23.0], share: 1 }],
    days: 'event',
  },
  church: {
    label: ['Church (Sunday)', 'Iglesia (domingo)'],
    people: 300, carShare: 0.4,
    windows: [{ in: [8.5, 9.5], share: 0.5 }, { out: [10.5, 11.5], share: 0.5 }, { in: [17.5, 18.5], share: 0.5 }, { out: [19.0, 20.0], share: 0.5 }],
    days: 'sunday',
  },
}

/** Average car occupancy for these trips (one parent per school run, etc.). */
export const OCCUPANCY = 1.3

const PRIVATE_NAME = /\b(colegio|school|academy|academia|instituto|liceo|montessori|bilingual|biling[uü]e)\b/i

/** An OSM element's kind, or null if it generates nothing we model. */
export function kindOf(tags = {}) {
  const a = tags.amenity, s = tags.shop, l = tags.leisure
  if (a === 'school' || a === 'kindergarten') {
    const priv = tags['operator:type'] === 'private' || tags['school:type'] === 'private' ||
      (tags['operator:type'] !== 'public' && PRIVATE_NAME.test(tags.name ?? ''))
    return priv ? 'school_private' : 'school_public'
  }
  if (a === 'university' || a === 'college') return 'university'
  if (a === 'hospital' || a === 'clinic') return 'hospital'
  if (a === 'place_of_worship' && (tags.religion === 'christian' || !tags.religion)) return 'church'
  if (s === 'mall' || s === 'department_store') return 'mall'
  if (s === 'supermarket') return 'supermarket'
  if (l === 'stadium') return 'stadium'
  if (tags.office || tags.building === 'office') return 'office'
  return null
}

/**
 * How many people a place moves, scaled by its footprint where OSM has one:
 * a 200 m2 office is not a 20-storey tower. Capacity tags win when present.
 */
export function peopleAt(kind, tags = {}, areaM2 = 0) {
  const k = KINDS[kind]
  const tagged = Number(tags.capacity ?? tags['capacity:pupils'] ?? NaN)
  if (Number.isFinite(tagged) && tagged > 0) return tagged
  if (!areaM2) return k.people
  const levels = Math.max(1, Number(tags['building:levels'] ?? 1) || 1)
  const perM2 = { office: 1 / 15, school_private: 1 / 8, school_public: 1 / 6, university: 1 / 10,
                  mall: 1 / 20, supermarket: 1 / 25, hospital: 1 / 30, church: 1 / 2, stadium: 0 }[kind] ?? 0
  // Floor at a tenth of the typical size: Santo Domingo tags many small
  // "plazas comerciales" shop=mall, and a 1,000 m2 strip is not Ágora Mall.
  return perM2 ? Math.round(Math.max(k.people * 0.1, Math.min(k.people * 4, areaM2 * levels * perM2))) : k.people
}

const isOn = (days, day, event) =>
  days === 'all' || (days === 'weekdays' && day >= 1 && day <= 5) || (days === 'sunday' && day === 0) ||
  (days === 'event' && event)

/**
 * Extra car trips a generator adds in each hour of a day: { in: [24], out: [24] }.
 * day: 0 = Sunday .. 6 = Saturday. rain: 0..1, extra share of people who drive.
 */
export function hourly(gen, { day = 2, rain = 0, event = false } = {}) {
  const k = KINDS[gen.kind]
  const h = { in: new Array(24).fill(0), out: new Array(24).fill(0) }
  if (!isOn(k.days, day, event)) return h
  // Rain moves some walkers and bus riders into cars, capped at 90%.
  const share = Math.min(0.9, k.carShare * (1 + rain * 0.35))
  const cars = (gen.people * share) / OCCUPANCY
  for (const w of k.windows) {
    const dir = w.in ? 'in' : 'out'
    const [a, b] = w[dir]
    // Spread evenly across the window's minutes, binned by hour.
    for (let t = a; t < b - 1e-9; t += 1 / 60) {
      h[dir][Math.floor(t)] += (cars * w.share) / ((b - a) * 60)
    }
  }
  return h
}

/** Rain factor for an hour from an Open-Meteo forecast: 0 dry .. 1 heavy (>= 4 mm/h). */
export const rainFactor = (mmPerHour) => Math.max(0, Math.min(1, (mmPerHour ?? 0) / 4))
