/**
 * What this site is. One codebase serves two sites, which differ only here:
 *
 *   MainstreetAi  (github.com/yefry08/MainstreetAi, GitHub Pages)
 *     Latin America: open data and AI for climate. Spanish and English; the
 *     61 Latin American cities; trees, bike lanes, transit and traffic.
 *   Greenlight AI (github.com/yefry08/greenlight, Vercel)
 *     The GenAI for Good Challenge (UNDP / IEEE): Pristina's transit use case,
 *     with Barcelona's recorded twin. English and Albanian.
 *
 * Anything that would make one site show the other's content belongs in this
 * file, not in a component.
 */
import { CITIES, regionOf } from './city/cities.js'

export const SITE = {
  name: 'MainstreetAi',
  tagline: { en: 'Open data and AI for Latin America’s streets', es: 'Datos abiertos e IA para las calles de América Latina' },
  langs: ['es', 'en'],
  // The recorded SUMO scenes (Barcelona, Manhattan). Off here: this site is
  // Latin America only.
  scenes: [],
  tabs: ['yours', 'green', 'transit', 'how', 'research', 'contact'],
  // Which catalogue cities the site offers.
  cities: (c) => regionOf(c) === 'Latin America',
  // Languages the transit assistant offers example questions in.
  askLangs: ['es', 'pt', 'en'],
  // The city a tab opens on when none is named.
  defaultCity: { transit: 'medellin', green: 'medellin' },
}

export const SITE_CITIES = CITIES.filter(SITE.cities)
export const hasScene = (key) => SITE.scenes.includes(key)
