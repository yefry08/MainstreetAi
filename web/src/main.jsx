import React from 'react'
import { createRoot } from 'react-dom/client'

// Self-hosted, not Google Fonts. The demo has to survive venue wifi, and a
// webfont that fails to load reflows every number on screen mid-pitch.
import '@fontsource/inter-tight/400.css'
import '@fontsource/inter-tight/500.css'
import '@fontsource/inter-tight/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'

import 'maplibre-gl/dist/maplibre-gl.css'
import './design/tokens.css'
import './design/shell.css'
import './styles.css'
import App from './App'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
