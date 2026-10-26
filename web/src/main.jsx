import React from 'react'
import { createRoot } from 'react-dom/client'

// Self-hosted, not Google Fonts. A demo has to survive venue wifi, and a
// webfont that fails to load reflows every readout in the bezel.
import '@fontsource/archivo/400.css'
import '@fontsource/archivo/500.css'
import '@fontsource/archivo/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'

// Country flags on Windows. Chromium there has no flag emoji and draws
// 🇵🇪 as the letters "PE" -- so on most desktops the list of every Latin
// American capital read as a column of two-letter codes. This loads a
// flags-only font (Twemoji, CC-BY 4.0) only on browsers that need it,
// served from this site rather than the package's default CDN.
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill'
import flagFontUrl from 'country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2?url'
polyfillCountryFlagEmojis('Twemoji Country Flags', flagFontUrl)

import 'maplibre-gl/dist/maplibre-gl.css'
import './design/tokens.css'
import './design/bezel.css'
import './design/panels.css'
import './design/shell.css'
import './design/trycity.css'
import App from './App'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
