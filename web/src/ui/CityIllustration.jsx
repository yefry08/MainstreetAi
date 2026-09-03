import Shibuya from './art/shibuya'
import Manhattan from './art/manhattan'
import Caba from './art/caba'
import LondonCity from './art/london_city'

/**
 * One illustration per district. Returns null for a district that has none,
 * so its card falls back to text rather than to a broken image slot.
 *
 * Each drawing is its own module: they are hand-authored and large-ish for
 * JSX, and keeping them apart means adding a city never touches another.
 * Barcelona has no entry on purpose -- its card opens the working demo.
 */
const ART = {
  shibuya: Shibuya,
  manhattan: Manhattan,
  caba: Caba,
  london_city: LondonCity,
}

export default function CityIllustration({ district }) {
  const Art = ART[district]
  return Art ? <Art /> : null
}
