import { useEffect, useState } from 'react'
import { MODES, LIGHTING } from '../pixel/lighting.js'

/**
 * Top navigation: tabs, lighting, and the chrome toggle.
 *
 * Collapses to a hamburger below tablet width. The breakpoint lives in CSS
 * rather than in a JS media-query listener so there is one source of truth and
 * no resize handler re-rendering the tree.
 */

export const TABS = [
  { key: 'home', label: 'Home' },
  { key: 'city', label: 'Try your city' },
  { key: 'contact', label: 'Contact' },
]

export default function Navbar({
  tab, onTab, mode, onMode, chrome, onChrome,
}) {
  const [open, setOpen] = useState(false)

  // A tab change should close the mobile menu; leaving it open covers the very
  // thing the user just navigated to.
  useEffect(() => { setOpen(false) }, [tab])

  return (
    <header className="nav">
      <div className="nav-inner">
        <button
          className="nav-burger"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span /><span /><span />
        </button>

        {/* The wordmark was a div. Everyone expects the logo to take them
            home and clicks it, so it needs to be a real button -- keyboard
            reachable and announced -- rather than decoration that silently
            ignores the click. */}
        <button
          className="nav-brand"
          onClick={() => onTab?.('home')}
          title="Back to the Barcelona scene"
        >
          <span className="nav-mark" />
          <span className="nav-name">MainstreetAi</span>
        </button>

        <nav className={`nav-tabs ${open ? 'open' : ''}`}>
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`nav-tab ${tab === t.key ? 'on' : ''}`}
              onClick={() => onTab?.(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="nav-right">
          {/* Lighting only means anything over a map. */}
          {tab !== 'contact' && (
            <div className="nav-light" role="group" aria-label="Lighting">
              {MODES.map((m) => (
                <button
                  key={m}
                  className={`light-btn ${mode === m ? 'on' : ''}`}
                  onClick={() => onMode?.(m)}
                  title={`${LIGHTING[m].label} lighting`}
                >
                  {LIGHTING[m].label}
                </button>
              ))}
            </div>
          )}

          {tab === 'home' && (
            <button
              className={`nav-chrome ${chrome ? '' : 'off'}`}
              onClick={() => onChrome?.(!chrome)}
              title={chrome ? 'Hide panels for a clean view' : 'Show panels'}
            >
              {chrome ? 'Hide panels' : 'Show panels'}
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
