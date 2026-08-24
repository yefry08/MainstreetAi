import { useEffect, useState } from 'react'

/**
 * Barcelona's ACTUAL congestion, right now, next to the simulated clock.
 *
 * Everything else on screen is simulation. This one readout is the real city:
 * the Ajuntament publishes the measured state of 532 instrumented sections
 * every few minutes, and this shows what it says at this moment. That is the
 * whole point of putting it in the masthead — the demo claims to model
 * Barcelona, so the real Barcelona should be visible beside it and clearly
 * marked as the thing that is not a model.
 *
 * Three honesty rules, all of which the server already enforces and this
 * component must not undo:
 *
 *  - Sections whose detector is down report "no data" and are excluded, so the
 *    percentage is a share of what is actually MEASURING. The denominator
 *    moves between polls as detectors drop in and out; that is real, not a bug.
 *  - A reading has an age. Past a few minutes it is labelled stale rather than
 *    shown as though it were current.
 *  - If the feed is unreachable the component renders nothing at all. A live
 *    badge with no live data behind it is worse than no badge.
 */

// The server caches for 3 minutes; polling faster only re-reads the same
// numbers. Slightly offset so it does not sit exactly on the TTL boundary.
const POLL_MS = 200_000
const STALE_S = 900

export default function LiveCity() {
  const [live, setLive] = useState(null)

  useEffect(() => {
    let alive = true
    let timer = null

    const poll = async () => {
      try {
        const r = await fetch('/api/feeds/bcn')
        const d = await r.json()
        // Only "ok" and "stale" carry data; anything else means we have
        // nothing real to show, so show nothing.
        if (alive) setLive(d && (d.status === 'ok' || d.status === 'stale') ? d : null)
      } catch {
        if (alive) setLive(null)
      }
      if (alive) timer = setTimeout(poll, POLL_MS)
    }

    poll()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [])

  if (!live || live.congested_pct == null) return null

  const ageMin = live.age_s == null ? null : live.age_s / 60
  const stale = live.age_s != null && live.age_s > STALE_S
  const pct = live.congested_pct

  const title =
    `${live.attribution}\n` +
    `${live.congested} of ${live.sections_reporting} reporting sections ` +
    `dense or worse (${live.sections_total} instrumented)\n` +
    `observed ${live.observed_at}` +
    (ageMin == null ? '' : ` — ${ageMin.toFixed(0)} min ago`)

  return (
    <span className={`livecity ${stale ? 'stale' : ''}`} title={title}>
      <span className="livecity-dot" />
      <span className="livecity-label">BCN live</span>
      <span className="livecity-value value">{pct.toFixed(1)}%</span>
      <span className="livecity-unit">congested</span>
    </span>
  )
}
