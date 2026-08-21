import { useEffect, useState } from 'react'

const HOME = { center: [2.1655, 41.3925], zoom: 15.1, pitch: 66, bearing: -18 }
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)

/**
 * Camera chrome.
 *
 * Zoom has visible buttons because scroll-to-zoom is invisible on a projector
 * and a presenter needs something to point at. The compass exists because
 * MapLibre binds rotation to right-drag and ctrl-drag only — undiscoverable —
 * and because a rotated map with no way back to north is a trap.
 */
export default function CameraControls({ map }) {
  const [bearing, setBearing] = useState(0)
  const [pitch, setPitch] = useState(0)

  useEffect(() => {
    if (!map) return
    const sync = () => {
      setBearing(map.getBearing())
      setPitch(map.getPitch())
    }
    sync()
    map.on('move', sync)
    return () => map.off('move', sync)
  }, [map])

  if (!map) return null
  const flat = pitch < 8

  return (
    <div className="camera-stack">
      <div className="glass ctrl-group">
        <button
          className="ctrl"
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => map.zoomIn({ duration: 300 })}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6"
                  strokeLinecap="round" />
          </svg>
        </button>
        <span className="ctrl-sep" />
        <button
          className="ctrl"
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => map.zoomOut({ duration: 300 })}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 8h10" stroke="currentColor" strokeWidth="1.6"
                  strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="glass ctrl-group">
        <button
          className="ctrl"
          title={`Bearing ${Math.round(((bearing % 360) + 360) % 360)}° — click for north`}
          aria-label="Reset bearing to north"
          onClick={() => map.easeTo({ bearing: 0, duration: 500, easing: easeOutCubic })}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"
               style={{ transform: `rotate(${-bearing}deg)` }}>
            <circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor"
                    strokeWidth="1" opacity="0.35" />
            <path d="M10 3.6 L12.4 10 L10 8.8 L7.6 10 Z"
                  fill="var(--terracota-500)" />
            <path d="M10 16.4 L7.6 10 L10 11.2 L12.4 10 Z"
                  fill="currentColor" opacity="0.5" />
          </svg>
        </button>
        <span className="ctrl-sep" />
        <button
          className={`ctrl ${flat ? '' : 'on'}`}
          title={flat ? 'Tilt into 3D' : 'Flatten to overhead'}
          aria-label="Toggle tilt"
          onClick={() =>
            map.easeTo({ pitch: flat ? 66 : 0, duration: 600, easing: easeOutCubic })
          }
        >
          <span className="ctrl-text">3D</span>
        </button>
      </div>

      <div className="glass ctrl-group">
        <button
          className="ctrl"
          title="Return to the Eixample"
          aria-label="Return to start"
          onClick={() => map.flyTo({ ...HOME, duration: 1400, curve: 1.5, essential: true })}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2.5 7.2 L8 2.8 L13.5 7.2 M4.3 6.2 V13 h7.4 V6.2"
                  fill="none" stroke="currentColor" strokeWidth="1.4"
                  strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export { HOME }
