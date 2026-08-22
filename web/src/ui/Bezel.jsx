import { useEffect, useRef } from 'react'

/**
 * The instrument bezel: live camera state framing the bottom of the viewport.
 *
 * Everything here is written straight to the DOM rather than through React
 * state. MapLibre fires `move` on every animation frame of every drag, and
 * re-rendering a React tree at that rate to change six numbers would compete
 * with the thing actually being measured. Refs + textContent keeps the
 * readouts genuinely live and costs nothing.
 */

const PX_PER_DEG = 3.6
const CARDINALS = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }

// Ticks are built once at module scope; only the strip's transform changes
// afterwards.
//
// The range has to be SYMMETRIC and generous. MapLibre normalises bearing to
// (-180, 180], and a tick sits on screen at (deg - bearing) * PX_PER_DEG from
// centre. So covering a 1920px-wide tape at bearing -180 needs marks down to
// roughly -450°. An asymmetric range looks fine facing north and leaves half
// the tape blank facing south — which is exactly how this was first written.
const TICK_SPAN = 540
const TICKS = []
for (let deg = -TICK_SPAN; deg <= TICK_SPAN; deg += 10) {
  const norm = ((deg % 360) + 360) % 360
  TICKS.push({
    deg,
    norm,
    cardinal: CARDINALS[norm],
    major: norm % 30 === 0,
  })
}

export default function Bezel({ map, header }) {
  const tapeRef = useRef(null)
  const latRef = useRef(null)
  const lonRef = useRef(null)
  const zoomRef = useRef(null)
  const pitchRef = useRef(null)
  const bearingRef = useRef(null)

  useEffect(() => {
    if (!map) return

    const sync = () => {
      const c = map.getCenter()
      const b = map.getBearing()

      // Hemisphere letters rather than signed degrees: this is a readout, and
      // "41.39250° N" is how a coordinate is actually spoken.
      if (latRef.current)
        latRef.current.textContent =
          `${Math.abs(c.lat).toFixed(5)}° ${c.lat >= 0 ? 'N' : 'S'}`
      if (lonRef.current)
        lonRef.current.textContent =
          `${Math.abs(c.lng).toFixed(5)}° ${c.lng >= 0 ? 'E' : 'W'}`
      if (zoomRef.current) zoomRef.current.textContent = map.getZoom().toFixed(2)
      if (pitchRef.current)
        pitchRef.current.textContent = `${map.getPitch().toFixed(1)}°`

      // Bearing shown 0–360 clockwise from north, the way a heading is read.
      const heading = ((b % 360) + 360) % 360
      if (bearingRef.current)
        bearingRef.current.textContent = `${heading.toFixed(1)}°`

      // The tape scrolls beneath a fixed index. Translating one strip is a
      // single compositor-friendly transform — no layout, no repaint.
      if (tapeRef.current)
        tapeRef.current.style.transform = `translateX(${-b * PX_PER_DEG}px)`
    }

    sync()
    map.on('move', sync)
    map.on('rotate', sync)
    return () => {
      map.off('move', sync)
      map.off('rotate', sync)
    }
  }, [map])

  return (
    <div className="bezel">
      <BearingTape stripRef={tapeRef} />

      <div className="readouts">
        <Readout label="Latitude" valueRef={latRef} wide />
        <Readout label="Longitude" valueRef={lonRef} wide />
        <span className="readout-rule" />
        <Readout label="Zoom" valueRef={zoomRef} />
        <Readout label="Pitch" valueRef={pitchRef} />
        <Readout label="Bearing" valueRef={bearingRef} />

        {header?.twins?.ai?.metrics && (
          <>
            <span className="readout-rule" />
            <div className="readout">
              <span className="label">On street</span>
              <span className="value">
                {header.twins.ai.metrics.running.toLocaleString()}
              </span>
            </div>
            <div className="readout">
              <span className="label">Queued</span>
              <span className="value queued">
                {header.twins.ai.metrics.halting.toLocaleString()}
              </span>
            </div>
          </>
        )}

        {/* Rotation is bound to right-drag and ctrl-drag and is otherwise
            undiscoverable, so the bezel says so once, quietly. */}
        <div className="bezel-hint">
          <div><b>drag</b> pan · <b>scroll</b> zoom</div>
          <div><b>right-drag</b> orbit · <b>ctrl-drag</b> tilt</div>
        </div>
      </div>
    </div>
  )
}

function Readout({ label, valueRef, wide }) {
  return (
    <div className={`readout ${wide ? 'wide' : ''}`}>
      <span className="label">{label}</span>
      <span className="value" ref={valueRef}>
        –
      </span>
    </div>
  )
}

/**
 * Compass tape — the signature element.
 *
 * It turns a dark map into an instrument, and it gives rotation (the control
 * nobody discovers on a map) a visible consequence, which is most of why
 * people find it at all.
 */
function BearingTape({ stripRef }) {
  return (
    <div className="tape">
      <div className="tape-strip" ref={stripRef}>
        {TICKS.map((t) => (
          <div
            key={t.deg}
            className={`tick ${t.cardinal ? 'cardinal' : t.major ? 'major' : ''}`}
            style={{ left: `${t.deg * PX_PER_DEG}px` }}
          >
            <i />
            {(t.cardinal || t.major) && (
              <span>{t.cardinal || String(t.norm).padStart(3, '0')}</span>
            )}
          </div>
        ))}
      </div>
      {/* The only place terracotta appears in the entire bezel. */}
      <div className="tape-index" />
      <div className="tape-fade tape-fade-l" />
      <div className="tape-fade tape-fade-r" />
    </div>
  )
}
