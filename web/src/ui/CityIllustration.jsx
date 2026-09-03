import SanFrancisco from './art/sanfrancisco'

/**
 * One illustration per district. Returns null for a district that has none,
 * so its card falls back to text rather than to a broken image slot.
 *
 * Only San Francisco is drawn now. The four flat SVG cards were replaced by a
 * single CSS-3D diorama done properly: one good drawing carries the section
 * better than four rough ones, and the other cities keep their place in the
 * registry for when their simulations are built. Those files are still in
 * art/ if the flat style is ever wanted again.
 *
 * Barcelona has no entry on purpose -- its card opens the working demo.
 */
const ART = {
  sf_downtown: SanFrancisco,
}

export default function CityIllustration({ district }) {
  const Art = ART[district]
  return Art ? <Art /> : null
}
