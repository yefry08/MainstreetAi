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
