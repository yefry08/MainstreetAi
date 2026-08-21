import { useEffect, useState } from 'react'
import { PRESETS, flyToPreset } from '../scene/cameraPresets'

/**
 * Camera chrome.
 *
 * Every control here exists because a keyboard/mouse affordance in MapLibre is
 * undiscoverable: rotation is bound to right-drag and ctrl-drag, and nobody
 * finds that on a projector in front of an audience. The compass makes the
 * camera's state visible and gives you a way back to north when you get lost.
 */
export default function NavControls({ map }) {
  const [bearing, setBearing] = useState(0)
  const [pitch, setPitch] = useState(0)
  const [zoom, setZoom] = useState(0)

  useEffect(() => {
    if (!map) return
    const sync = () => {
      setBearing(map.getBearing())
      setPitch(map.getPitch())
      setZoom(map.getZoom())
    }
    sync()
    map.on('move', sync)
    return () => map.off('move', sync)
  }, [map])

  if (!map) return null

  const flat = pitch < 8

  return (
    <div className="nav-stack">
      <div className="glass nav-group">
        <button
          className="nav-btn"
          onClick={() => map.zoomIn({ duration: 320 })}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <PlusIcon />
        </button>
        <div className="nav-sep" />
        <button
          className="nav-btn"
          onClick={() => map.zoomOut({ duration: 320 })}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <MinusIcon />
        </button>
      </div>

      <div className="glass nav-group">
        <button
          className="nav-btn compass"
          onClick={() =>
            map.easeTo({ bearing: 0, duration: 520, easing: easeOutCubic })
          }
          aria-label="Reset bearing to north"
          title={`Bearing ${Math.round(bearing)}° — click to face north`}
        >
          <CompassIcon rotation={-bearing} />
        </button>
        <div className="nav-sep" />
        <button
          className={`nav-btn ${flat ? '' : 'on'}`}
          onClick={() =>
            map.easeTo({
              pitch: flat ? 66 : 0,
              duration: 620,
              easing: easeOutCubic,
            })
          }
          aria-label="Toggle 3D tilt"
          title={flat ? 'Tilt into 3D' : 'Flatten to overhead'}
        >
          <span className="nav-label">3D</span>
        </button>
      </div>

      <div className="nav-readout glass">
        <span className="num">{zoom.toFixed(1)}</span>
        <span className="nav-readout-unit">zoom</span>
      </div>
    </div>
  )
}

/** Fly-to shortcuts. The hint text doubles as the demo script. */
export function ViewPresets({ map, active, onPick }) {
  return (
    <div className="glass views">
      {Object.entries(PRESETS).map(([key, p]) => (
        <button
          key={key}
          className={`view-chip ${active === key ? 'on' : ''}`}
          title={p.hint}
          onClick={() => {
            flyToPreset(map, key)
            onPick?.(key)
          }}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 3v10M3 8h10"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

function MinusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

/** North needle stays terracotta — the one place the accent earns its keep here. */
function CompassIcon({ rotation }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 20 20"
      aria-hidden="true"
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <circle cx="10" cy="10" r="7.4" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.42" />
      <path d="M10 3.4 L12.5 10 L10 8.7 L7.5 10 Z" fill="var(--terracotta-500)" />
      <path d="M10 16.6 L7.5 10 L10 11.3 L12.5 10 Z" fill="currentColor" opacity="0.55" />
    </svg>
  )
}
