import { useEffect, useState } from 'react'
import { MODES, LIGHTING } from '../pixel/lighting.js'
import { useT } from '../i18n'

/**
 * Top navigation: tabs, lighting, and the chrome toggle.
 *
 * Collapses to a hamburger below tablet width. The breakpoint lives in CSS
 * rather than in a JS media-query listener so there is one source of truth and
 * no resize handler re-rendering the tree.
 */

export const TABS = [
  { key: 'home', label: 'Barcelona', es: 'Barcelona' },
  { key: 'manhattan', label: 'Manhattan', es: 'Manhattan' },
  { key: 'yours', label: 'Your city', es: 'Tu ciudad' },
  { key: 'transit', label: 'Transit', es: 'Transporte' },
  { key: 'how', label: 'How it works', es: 'Cómo funciona' },
  { key: 'research', label: 'Research', es: 'Investigación' },
  { key: 'contact', label: 'Contact', es: 'Contacto' },
]

export default function Navbar({
  tab, onTab, mode, onMode, chrome, onChrome, lang = 'en', onLang,
}) {
  const [open, setOpen] = useState(false)
  const tr = useT()

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
          onClick={() => onTab?.('landing')}
          title="MainstreetAi — overview"
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
              {lang === 'es' ? t.es : t.label}
            </button>
          ))}
        </nav>

        <div className="nav-right">
          <div className="nav-lang" role="group" aria-label={tr('Language', 'Idioma')}>
            {[['es', 'ES'], ['en', 'EN']].map(([l, label]) => (
              <button key={l} className={lang === l ? 'on' : ''} aria-pressed={lang === l}
                      onClick={() => onLang?.(l)}>{label}</button>
            ))}
          </div>

          {/* Lighting only means anything over a map. */}
          {/* Not on Your city either: it draws its own 2D canvas, which the
              lighting modes do not touch. */}
          {tab !== 'contact' && tab !== 'research' && tab !== 'how' && tab !== 'yours' && tab !== 'transit' &&
           tab !== 'landing' && (
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
              title={chrome ? tr('Hide panels for a clean view', 'Ocultar paneles para ver limpio') : tr('Show panels', 'Mostrar paneles')}
            >
              {chrome ? tr('Hide panels', 'Ocultar paneles') : tr('Show panels', 'Mostrar paneles')}
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
