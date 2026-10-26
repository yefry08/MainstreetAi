/**
 * Country -> major city registry.
 *
 * WHY A FIXED LIST AND NOT A SEARCH BOX
 * Every city here has to survive the whole pipeline: an Overpass query for its
 * street network, a graph build, and a live micro-simulation. A free-text box
 * would accept "Springfield", find nothing, and hang -- the same failure the
 * old district list was built to avoid.
 *
 * THE 2M THRESHOLD
 * Below roughly two million the centre is often small enough that a 2 km
 * extract has too few signalised junctions for a controller to have anything
 * to coordinate. Populations are metropolitan-area figures, rounded, and are
 * used only for ordering and for the label -- nothing downstream depends on
 * them being exact.
 *
 * Coordinates are the city centre, and `km` is the side of the square extract
 * pulled from Overpass. Bigger is not better: the graph build and the
 * simulation both scale with it, and 2-3 km of a dense core carries more
 * signalised junctions than 8 km of suburb.
 */

export const CITIES = [
  // --- Europe ---
  { country: 'Spain',          flag: '🇪🇸', name: 'Madrid',         lat: 40.4168, lon: -3.7038, pop: 6.7,  km: 2.6 },
  { country: 'Spain',          flag: '🇪🇸', name: 'Barcelona',      lat: 41.3874, lon: 2.1686,  pop: 5.6,  km: 2.6 },
  { country: 'France',         flag: '🇫🇷', name: 'Paris',          lat: 48.8566, lon: 2.3522,  pop: 11.1, km: 2.4 },
  { country: 'United Kingdom', flag: '🇬🇧', name: 'London',         lat: 51.5074, lon: -0.1278, pop: 9.6,  km: 2.6 },
  { country: 'Germany',        flag: '🇩🇪', name: 'Berlin',         lat: 52.5200, lon: 13.4050, pop: 3.7,  km: 2.6 },
  { country: 'Italy',          flag: '🇮🇹', name: 'Rome',           lat: 41.9028, lon: 12.4964, pop: 4.3,  km: 2.4 },
  { country: 'Italy',          flag: '🇮🇹', name: 'Milan',          lat: 45.4642, lon: 9.1900,  pop: 3.1,  km: 2.4 },
  { country: 'Russia',         flag: '🇷🇺', name: 'Moscow',         lat: 55.7558, lon: 37.6173, pop: 12.6, km: 2.6 },
  { country: 'Turkey',         flag: '🇹🇷', name: 'Istanbul',       lat: 41.0082, lon: 28.9784, pop: 15.6, km: 2.4 },
  { country: 'Portugal',       flag: '🇵🇹', name: 'Lisbon',         lat: 38.7223, lon: -9.1393, pop: 2.9,  km: 2.4 },

  // --- Americas ---
  { country: 'Mexico',         flag: '🇲🇽', name: 'Mexico City',    lat: 19.4326, lon: -99.1332, pop: 22.0, km: 2.6, capital: true },
  { country: 'Mexico',         flag: '🇲🇽', name: 'Guadalajara',    lat: 20.6597, lon: -103.3496, pop: 5.3, km: 2.6 },
  { country: 'United States',  flag: '🇺🇸', name: 'New York',       lat: 40.7580, lon: -73.9855, pop: 19.5, km: 2.4 },
  { country: 'United States',  flag: '🇺🇸', name: 'Chicago',        lat: 41.8781, lon: -87.6298, pop: 9.5,  km: 2.6 },
  { country: 'United States',  flag: '🇺🇸', name: 'Los Angeles',    lat: 34.0522, lon: -118.2437, pop: 12.8, km: 2.8 },
  { country: 'Canada',         flag: '🇨🇦', name: 'Toronto',        lat: 43.6532, lon: -79.3832, pop: 6.3,  km: 2.6 },
  { country: 'Brazil',         flag: '🇧🇷', name: 'São Paulo',      lat: -23.5505, lon: -46.6333, pop: 22.4, km: 2.6 },
  { country: 'Brazil',         flag: '🇧🇷', name: 'Rio de Janeiro', lat: -22.9068, lon: -43.1729, pop: 13.5, km: 2.4 },
  { country: 'Argentina',      flag: '🇦🇷', name: 'Buenos Aires',   lat: -34.6037, lon: -58.3816, pop: 15.3, km: 2.6, capital: true },
  { country: 'Colombia',       flag: '🇨🇴', name: 'Bogotá',         lat: 4.7110,  lon: -74.0721, pop: 11.3, km: 2.6, capital: true },
  { country: 'Peru',           flag: '🇵🇪', name: 'Lima',           lat: -12.0464, lon: -77.0428, pop: 10.7, km: 2.6, capital: true },
  { country: 'Chile',          flag: '🇨🇱', name: 'Santiago',       lat: -33.4489, lon: -70.6693, pop: 6.8,  km: 2.6, capital: true },
  { country: 'Dominican Rep.', flag: '🇩🇴', name: 'Santo Domingo',  lat: 18.4861, lon: -69.9312, pop: 3.5,  km: 2.6, capital: true },

  // --- Latin America: every capital, and every city of ~2M+ ---------------
  // Coordinates are the dense core rather than the administrative centroid:
  // the extract is only ~2.5 km across, and a centroid in a park or a bay
  // produces a network with nothing to control.
  // Capitals
  { country: 'Guatemala',      flag: '🇬🇹', name: 'Guatemala City', lat: 14.6349, lon: -90.5069, pop: 3.0, km: 2.4, capital: true },
  { country: 'El Salvador',    flag: '🇸🇻', name: 'San Salvador',   lat: 13.6989, lon: -89.1914, pop: 1.1, km: 2.4, capital: true },
  { country: 'Honduras',       flag: '🇭🇳', name: 'Tegucigalpa',    lat: 14.0818, lon: -87.2068, pop: 1.3, km: 2.4, capital: true },
  { country: 'Nicaragua',      flag: '🇳🇮', name: 'Managua',        lat: 12.1364, lon: -86.2514, pop: 1.1, km: 2.4, capital: true },
  { country: 'Costa Rica',     flag: '🇨🇷', name: 'San José',       lat: 9.9333,  lon: -84.0833, pop: 1.4, km: 2.4, capital: true },
  { country: 'Panama',         flag: '🇵🇦', name: 'Panama City',    lat: 8.9824,  lon: -79.5199, pop: 1.9, km: 2.4, capital: true },
  { country: 'Cuba',           flag: '🇨🇺', name: 'Havana',         lat: 23.1330, lon: -82.3830, pop: 2.1, km: 2.4, capital: true },
  { country: 'Puerto Rico',    flag: '🇵🇷', name: 'San Juan',       lat: 18.4500, lon: -66.0667, pop: 2.4, km: 2.4, capital: true },
  { country: 'Venezuela',      flag: '🇻🇪', name: 'Caracas',        lat: 10.4996, lon: -66.8786, pop: 2.9, km: 2.6, capital: true },
  { country: 'Ecuador',        flag: '🇪🇨', name: 'Quito',          lat: -0.1807, lon: -78.4678, pop: 2.0, km: 2.4, capital: true },
  { country: 'Bolivia',        flag: '🇧🇴', name: 'La Paz',         lat: -16.4990, lon: -68.1340, pop: 2.0, km: 2.4, capital: true },
  { country: 'Bolivia',        flag: '🇧🇴', name: 'Sucre',          lat: -19.0476, lon: -65.2596, pop: 0.3, km: 2.4, capital: true },
  { country: 'Uruguay',        flag: '🇺🇾', name: 'Montevideo',     lat: -34.9055, lon: -56.1851, pop: 1.7, km: 2.6, capital: true },
  { country: 'Paraguay',       flag: '🇵🇾', name: 'Asunción',       lat: -25.2865, lon: -57.6470, pop: 2.3, km: 2.4, capital: true },
  { country: 'Brazil',         flag: '🇧🇷', name: 'Brasília',       lat: -15.7942, lon: -47.8822, pop: 4.8, km: 2.6, capital: true },
  // Largest cities
  { country: 'Mexico',         flag: '🇲🇽', name: 'Monterrey',      lat: 25.6714, lon: -100.3089, pop: 5.3, km: 2.6 },
  { country: 'Mexico',         flag: '🇲🇽', name: 'Puebla',         lat: 19.0433, lon: -98.1981, pop: 3.2, km: 2.4 },
  { country: 'Mexico',         flag: '🇲🇽', name: 'Toluca',         lat: 19.2896, lon: -99.6532, pop: 2.4, km: 2.4 },
  { country: 'Mexico',         flag: '🇲🇽', name: 'Tijuana',        lat: 32.5310, lon: -117.0360, pop: 2.2, km: 2.4 },
  { country: 'Mexico',         flag: '🇲🇽', name: 'León',           lat: 21.1220, lon: -101.6830, pop: 1.9, km: 2.4 },
  { country: 'Brazil',         flag: '🇧🇷', name: 'Belo Horizonte', lat: -19.9191, lon: -43.9386, pop: 6.0, km: 2.6 },
  { country: 'Brazil',         flag: '🇧🇷', name: 'Porto Alegre',   lat: -30.0277, lon: -51.2287, pop: 4.3, km: 2.4 },
  { country: 'Brazil',         flag: '🇧🇷', name: 'Recife',         lat: -8.0631,  lon: -34.8711, pop: 4.0, km: 2.4 },
  { country: 'Brazil',         flag: '🇧🇷', name: 'Fortaleza',      lat: -3.7319,  lon: -38.5267, pop: 4.0, km: 2.4 },
  { country: 'Brazil',         flag: '🇧🇷', name: 'Salvador',       lat: -12.9714, lon: -38.5014, pop: 3.9, km: 2.4 },
  { country: 'Brazil',         flag: '🇧🇷', name: 'Curitiba',       lat: -25.4290, lon: -49.2671, pop: 3.7, km: 2.4 },
  { country: 'Brazil',         flag: '🇧🇷', name: 'Campinas',       lat: -22.9056, lon: -47.0608, pop: 3.3, km: 2.4 },
  { country: 'Brazil',         flag: '🇧🇷', name: 'Goiânia',        lat: -16.6799, lon: -49.2550, pop: 2.6, km: 2.4 },
  { country: 'Brazil',         flag: '🇧🇷', name: 'Belém',          lat: -1.4558,  lon: -48.4902, pop: 2.5, km: 2.4 },
  { country: 'Brazil',         flag: '🇧🇷', name: 'Manaus',         lat: -3.1190,  lon: -60.0217, pop: 2.3, km: 2.4 },
  { country: 'Colombia',       flag: '🇨🇴', name: 'Medellín',       lat: 6.2476,  lon: -75.5658, pop: 4.0, km: 2.4 },
  { country: 'Colombia',       flag: '🇨🇴', name: 'Cali',           lat: 3.4516,  lon: -76.5320, pop: 2.8, km: 2.4 },
  { country: 'Colombia',       flag: '🇨🇴', name: 'Barranquilla',   lat: 10.9685, lon: -74.7813, pop: 2.3, km: 2.4 },
  { country: 'Argentina',      flag: '🇦🇷', name: 'Córdoba',        lat: -31.4167, lon: -64.1833, pop: 1.6, km: 2.4 },
  { country: 'Argentina',      flag: '🇦🇷', name: 'Rosario',        lat: -32.9468, lon: -60.6393, pop: 1.4, km: 2.4 },
  { country: 'Venezuela',      flag: '🇻🇪', name: 'Maracaibo',      lat: 10.6427, lon: -71.6125, pop: 2.2, km: 2.4 },
  { country: 'Venezuela',      flag: '🇻🇪', name: 'Valencia',       lat: 10.1620, lon: -68.0077, pop: 2.0, km: 2.4 },
  { country: 'Ecuador',        flag: '🇪🇨', name: 'Guayaquil',      lat: -2.1894,  lon: -79.8891, pop: 3.0, km: 2.4 },
  { country: 'Bolivia',        flag: '🇧🇴', name: 'Santa Cruz',     lat: -17.7833, lon: -63.1821, pop: 2.0, km: 2.4 },
  // Second cities: the largest city after the capital in each country that
  // did not already have one above.
  { country: 'Guatemala',      flag: '🇬🇹', name: 'Quetzaltenango', lat: 14.8347, lon: -91.5180, pop: 0.3, km: 2.4 },
  { country: 'El Salvador',    flag: '🇸🇻', name: 'Santa Ana',      lat: 13.9942, lon: -89.5597, pop: 0.4, km: 2.4 },
  { country: 'Honduras',       flag: '🇭🇳', name: 'San Pedro Sula', lat: 15.5042, lon: -88.0250, pop: 1.0, km: 2.4 },
  // A second "León" (Mexico's is above): an explicit slug keeps the two from
  // sharing one ready-made file.
  { country: 'Nicaragua',      flag: '🇳🇮', name: 'León',           lat: 12.4350, lon: -86.8790, pop: 0.2, km: 2.4, slug: 'leon-nicaragua' },
  { country: 'Costa Rica',     flag: '🇨🇷', name: 'Alajuela',       lat: 10.0163, lon: -84.2116, pop: 0.3, km: 2.4 },
  { country: 'Panama',         flag: '🇵🇦', name: 'Colón',          lat: 9.3592,  lon: -79.9014, pop: 0.3, km: 2.4 },
  { country: 'Cuba',           flag: '🇨🇺', name: 'Santiago de Cuba', lat: 20.0217, lon: -75.8294, pop: 0.5, km: 2.4 },
  { country: 'Dominican Rep.', flag: '🇩🇴', name: 'Santiago de los Caballeros', lat: 19.4517, lon: -70.6970, pop: 1.0, km: 2.4 },
  { country: 'Puerto Rico',    flag: '🇵🇷', name: 'Ponce',          lat: 18.0111, lon: -66.6141, pop: 0.1, km: 2.4 },
  { country: 'Peru',           flag: '🇵🇪', name: 'Arequipa',       lat: -16.3989, lon: -71.5369, pop: 1.1, km: 2.4 },
  { country: 'Chile',          flag: '🇨🇱', name: 'Valparaíso',     lat: -33.0458, lon: -71.6197, pop: 1.0, km: 2.4 },
  { country: 'Uruguay',        flag: '🇺🇾', name: 'Salto',          lat: -31.3833, lon: -57.9667, pop: 0.1, km: 2.4 },
  { country: 'Paraguay',       flag: '🇵🇾', name: 'Ciudad del Este', lat: -25.5097, lon: -54.6111, pop: 0.3, km: 2.4 },

  // --- Asia / Oceania / Africa ---
  { country: 'Japan',          flag: '🇯🇵', name: 'Tokyo',          lat: 35.6762, lon: 139.6503, pop: 37.0, km: 2.4 },
  { country: 'Japan',          flag: '🇯🇵', name: 'Osaka',          lat: 34.6937, lon: 135.5023, pop: 19.0, km: 2.4 },
  { country: 'South Korea',    flag: '🇰🇷', name: 'Seoul',          lat: 37.5665, lon: 126.9780, pop: 25.6, km: 2.4 },
  { country: 'China',          flag: '🇨🇳', name: 'Shanghai',       lat: 31.2304, lon: 121.4737, pop: 28.5, km: 2.4 },
  { country: 'China',          flag: '🇨🇳', name: 'Beijing',        lat: 39.9042, lon: 116.4074, pop: 21.9, km: 2.6 },
  { country: 'India',          flag: '🇮🇳', name: 'Mumbai',         lat: 19.0760, lon: 72.8777, pop: 21.3, km: 2.4 },
  { country: 'India',          flag: '🇮🇳', name: 'Delhi',          lat: 28.6139, lon: 77.2090, pop: 32.9, km: 2.6 },
  { country: 'Thailand',       flag: '🇹🇭', name: 'Bangkok',        lat: 13.7563, lon: 100.5018, pop: 10.7, km: 2.4 },
  { country: 'Indonesia',      flag: '🇮🇩', name: 'Jakarta',        lat: -6.2088, lon: 106.8456, pop: 33.4, km: 2.4 },
  { country: 'Singapore',      flag: '🇸🇬', name: 'Singapore',      lat: 1.3521,  lon: 103.8198, pop: 6.0,  km: 2.4 },
  { country: 'Egypt',          flag: '🇪🇬', name: 'Cairo',          lat: 30.0444, lon: 31.2357, pop: 22.2, km: 2.4 },
  { country: 'Nigeria',        flag: '🇳🇬', name: 'Lagos',          lat: 6.5244,  lon: 3.3792,  pop: 15.4, km: 2.4 },
  { country: 'South Africa',   flag: '🇿🇦', name: 'Johannesburg',   lat: -26.2041, lon: 28.0473, pop: 6.0, km: 2.6 },
  { country: 'Australia',      flag: '🇦🇺', name: 'Sydney',         lat: -33.8688, lon: 151.2093, pop: 5.3, km: 2.4 },
]

/**
 * Regions, in the order the picker shows them. Latin America leads: it is
 * where this project's adaptive-signal work is aimed, and with every capital
 * and every ~2M+ city it is now most of the list.
 */
export const REGIONS = ['Latin America', 'North America', 'Europe', 'Asia & Oceania', 'Africa']

const REGION_OF = {
  'Mexico': 'Latin America', 'Guatemala': 'Latin America', 'El Salvador': 'Latin America',
  'Honduras': 'Latin America', 'Nicaragua': 'Latin America', 'Costa Rica': 'Latin America',
  'Panama': 'Latin America', 'Cuba': 'Latin America',
  'Puerto Rico': 'Latin America', 'Dominican Rep.': 'Latin America', 'Venezuela': 'Latin America',
  'Colombia': 'Latin America', 'Ecuador': 'Latin America', 'Peru': 'Latin America',
  'Bolivia': 'Latin America', 'Chile': 'Latin America', 'Argentina': 'Latin America',
  'Uruguay': 'Latin America', 'Paraguay': 'Latin America', 'Brazil': 'Latin America',
  'United States': 'North America', 'Canada': 'North America',
  'Spain': 'Europe', 'France': 'Europe', 'United Kingdom': 'Europe', 'Germany': 'Europe',
  'Italy': 'Europe', 'Russia': 'Europe', 'Turkey': 'Europe', 'Portugal': 'Europe',
  'Japan': 'Asia & Oceania', 'South Korea': 'Asia & Oceania', 'China': 'Asia & Oceania',
  'India': 'Asia & Oceania', 'Thailand': 'Asia & Oceania', 'Indonesia': 'Asia & Oceania',
  'Singapore': 'Asia & Oceania', 'Australia': 'Asia & Oceania',
  'Egypt': 'Africa', 'Nigeria': 'Africa', 'South Africa': 'Africa',
}

export const regionOf = (c) => REGION_OF[c.country] ?? 'Other'

/** Cities grouped by region (REGIONS order), each sorted by country then size. */
export function byRegion(cities = CITIES) {
  const out = new Map(REGIONS.map((r) => [r, []]))
  for (const c of cities) {
    const r = regionOf(c)
    if (!out.has(r)) out.set(r, [])
    out.get(r).push(c)
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.country.localeCompare(b.country, 'en') || b.pop - a.pop)
  }
  return [...out.entries()].filter(([, l]) => l.length).map(([region, list]) => ({ region, cities: list }))
}

/** Countries, alphabetical, each with its cities largest-first. */
export function byCountry() {
  const map = new Map()
  for (const c of CITIES) {
    if (!map.has(c.country)) map.set(c.country, { country: c.country, flag: c.flag, cities: [] })
    map.get(c.country).cities.push(c)
  }
  for (const entry of map.values()) entry.cities.sort((a, b) => b.pop - a.pop)
  return [...map.values()].sort((a, b) => a.country.localeCompare(b.country, 'en'))
}

/** The square extract around a city centre, as [S, W, N, E] for Overpass. */
export function bbox(city) {
  const half = city.km / 2
  const dLat = half / 111.32
  const dLon = half / (111.32 * Math.cos((city.lat * Math.PI) / 180))
  return [city.lat - dLat, city.lon - dLon, city.lat + dLat, city.lon + dLon]
}

export const cityId = (c) => `${c.country}:${c.name}`

/**
 * File-safe name for a ready-made city: "São Paulo" -> "sao-paulo".
 * Accents are stripped rather than encoded, because GitHub Pages serves the
 * path as given and a percent-encoded filename is one more thing to get wrong.
 */
export const citySlug = (c) => c.slug ?? c.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
