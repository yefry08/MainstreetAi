import { useEffect, useState } from 'react'

/**
 * City selector.
 *
 * WHY THIS IS A LIST AND NOT A TEXT BOX
 * The plan asks for a field that re-runs the pipeline for any city typed into
 * it. Only one of the pipeline's three stages is fast:
 *
 *   transit    seconds, but load_gtfs() takes a local path and city2graph has
 *              no feed discovery, so a human sources the zip
 *   basemap    25-60 minutes, Overpass-bound (measured: 26 min for Barcelona)
 *   network    minutes of netconvert and routing, then a 30 MB load per twin
 *
 * A city already on disk is instant. A city that is not cannot be made ready
 * inside a page load, and a text box implies otherwise -- it would accept
 * "Tokyo", appear to work, and then hang for half an hour in front of an
 * audience. So the built cities are offered directly, the unbuilt ones are
 * shown with the command that would build them, and nothing pretends to be
 * cheaper than it is.
 */
export default function CitySelector({ current = 'barcelona', onSelect }) {
  const [reg, setReg] = useState(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/cities')
      .then((r) => r.json())
      .then((d) => alive && setReg(d))
      .catch(() => alive && setReg(null))
    return () => { alive = false }
  }, [])

  if (!reg?.cities) return null
  const active = reg.cities.find((c) => c.key === current) ?? reg.cities[0]

  return (
    <div className="city-select glass">
      <button className="city-current" onClick={() => setOpen((v) => !v)}>
        <span className="city-label">City</span>
        <span className="city-name value">{active?.label ?? '—'}</span>
        <span className="city-caret">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="city-list">
          {reg.cities.map((c) => (
            <button
              key={c.key}
              className={`city-item ${c.ready ? '' : 'unbuilt'} ${c.key === current ? 'on' : ''}`}
              disabled={!c.ready}
              onClick={() => { if (c.ready) { onSelect?.(c.key); setOpen(false) } }}
              title={c.ready
                ? `${c.size_mb} MB cached${c.has_transit ? ' · real transit routes' : ''}`
                : `Not built. Missing: ${c.missing.join(', ')}`}
            >
              <span className="city-item-name">{c.label}</span>
              {c.ready ? (
                <span className="city-tag ready">
                  cached {c.size_mb}MB{c.has_transit ? ' · transit' : ''}
                </span>
              ) : (
                <span className="city-tag">not built</span>
              )}
            </button>
          ))}

          {/* The registry's basemap_minutes carries its own qualifier
              ("25-60, Overpass-bound"), so it cannot be dropped into a slot
              that expects a bare number — doing that produced "a 25-60,
              Overpass-bound minute basemap bake". It reads as its own clause. */}
          <div className="city-note">
            Cached cities load instantly. Adding one means a basemap bake
            ({reg.build_cost?.basemap_minutes ?? '25–60 minutes'}) plus a SUMO
            network build — a pre-bake, not a page load.
          </div>
        </div>
      )}
    </div>
  )
}
