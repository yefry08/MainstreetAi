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
  { country: 'Mexico',         flag: '🇲🇽', name: 'Mexico City',    lat: 19.4326, lon: -99.1332, pop: 22.0, km: 2.6 },
  { country: 'Mexico',         flag: '🇲🇽', name: 'Guadalajara',    lat: 20.6597, lon: -103.3496, pop: 5.3, km: 2.6 },
  { country: 'United States',  flag: '🇺🇸', name: 'New York',       lat: 40.7580, lon: -73.9855, pop: 19.5, km: 2.4 },
  { country: 'United States',  flag: '🇺🇸', name: 'Chicago',        lat: 41.8781, lon: -87.6298, pop: 9.5,  km: 2.6 },
  { country: 'United States',  flag: '🇺🇸', name: 'Los Angeles',    lat: 34.0522, lon: -118.2437, pop: 12.8, km: 2.8 },
  { country: 'Canada',         flag: '🇨🇦', name: 'Toronto',        lat: 43.6532, lon: -79.3832, pop: 6.3,  km: 2.6 },
  { country: 'Brazil',         flag: '🇧🇷', name: 'São Paulo',      lat: -23.5505, lon: -46.6333, pop: 22.4, km: 2.6 },
  { country: 'Brazil',         flag: '🇧🇷', name: 'Rio de Janeiro', lat: -22.9068, lon: -43.1729, pop: 13.5, km: 2.4 },
  { country: 'Argentina',      flag: '🇦🇷', name: 'Buenos Aires',   lat: -34.6037, lon: -58.3816, pop: 15.3, km: 2.6 },
  { country: 'Colombia',       flag: '🇨🇴', name: 'Bogotá',         lat: 4.7110,  lon: -74.0721, pop: 11.3, km: 2.6 },
  { country: 'Peru',           flag: '🇵🇪', name: 'Lima',           lat: -12.0464, lon: -77.0428, pop: 10.7, km: 2.6 },
  { country: 'Chile',          flag: '🇨🇱', name: 'Santiago',       lat: -33.4489, lon: -70.6693, pop: 6.8,  km: 2.6 },
  { country: 'Dominican Rep.', flag: '🇩🇴', name: 'Santo Domingo',  lat: 18.4861, lon: -69.9312, pop: 3.5,  km: 2.6 },

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
export const citySlug = (c) =>
  c.name.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
