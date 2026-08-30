import { useEffect, useRef, useState } from 'react'
import { loadReplay } from '../pixel/replay.js'

/**
 * Feed the 3D scene from a recording instead of the WebSocket.
 *
 * WHY THIS EXISTS
 * Home is the 3D scene, and the 3D scene draws whatever is in frameRef. On a
 * static host there is no Python server, so that ref stays null and the hero is
 * a beautifully lit, completely empty city -- 0 vehicles, 0 lit signals, no
 * clock. A landing page whose whole subject is traffic, with no traffic in it.
 *
 * It costs almost nothing to avoid, because the recording is already in the
 * exact shape the socket produces: { header, vehicles: Float32Array (6 floats
 * per vehicle), signals: Uint8Array }. Both ends were built against the same
 * wire format, so the recorded frames drop straight into the same ref the live
 * decoder writes. This hook is only the playback clock.
 *
 * It deliberately does NOT own a renderer. The scene keeps its own loop and
 * reads the ref when it draws, exactly as it does when the server is live --
 * which is what keeps one code path through the 3D renderer rather than two.
 */
export function useReplayFrames({ enabled = false, district = 'barcelona', twin = 'ai' } = {}) {
  const frameRef = useRef(null)
  const twinRef = useRef(twin)
  const [meta, setMeta] = useState(null)

  useEffect(() => { twinRef.current = twin }, [twin])

  useEffect(() => {
    if (!enabled) return
    let alive = true
    let raf = 0

    ;(async () => {
      let replay = null
      try {
        replay = await loadReplay(
          district === 'barcelona' ? './replay' : `./replay_${district}`)
      } catch {
        // No recording for this district. The scene simply has no traffic,
        // which is the same state it would be in without this hook -- there is
        // nothing to fall back to and nothing to crash over.
        return
      }
      if (!alive || !replay) return
      setMeta({ stats: replay.stats, recordedAt: replay.recordedAt })

      const period = 1000 / (replay.hz || 4)
      let last = performance.now()
      let idx = 0

      const tick = () => {
        if (!alive) return
        const now = performance.now()
        if (now - last >= period) {
          last = now
          idx += 1
          const f = replay.frame(twinRef.current, idx)
          if (f) frameRef.current = f
        }
        raf = requestAnimationFrame(tick)
      }
      const f0 = replay.frame(twinRef.current, 0)
      if (f0) frameRef.current = f0
      raf = requestAnimationFrame(tick)

      // rAF is throttled to zero in a tab that is not compositing, which stalls
      // the clock and makes a healthy recording look like a dead one. This
      // advances it by hand for exactly that case.
      window.__replayFrames = {
        advance: (n = 1) => {
          for (let i = 0; i < n; i++) {
            const f = replay.frame(twinRef.current, ++idx)
            if (f) frameRef.current = f
          }
          return frameRef.current?.header ?? null
        },
      }
    })()

    return () => { alive = false; if (raf) cancelAnimationFrame(raf) }
  }, [enabled, district])

  return { frameRef, meta }
}
