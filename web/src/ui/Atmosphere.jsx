import { useEffect, useRef } from 'react'

/**
 * Horizon haze.
 *
 * At high pitch the top of the frame is otherwise a hard black void with the
 * city stopping dead against it, which reads as a rendering bug rather than a
 * night sky. MapLibre 4 has no `sky` property (that arrived in 5), so this is
 * a screen-space overlay instead: a deep sky wash, plus a faint warm band
 * sitting right on the horizon line.
 *
 * The warm band is real, not decoration — it is the sodium and LED glow a city
 * throws onto the underside of its own sky, which is exactly what Barcelona
 * looks like from above after dark. It is held at very low opacity and is
 * atmosphere rather than accent: it must never compete with the terracotta,
 * which stays the only deliberate warm mark on screen.
 *
 * Opacity tracks pitch, because at an overhead view there is no horizon to
 * haze and the wash would just be a grey film over the map.
 */
export default function Atmosphere({ map }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!map) return

    const sync = () => {
      const el = ref.current
      if (!el) return
      // Nothing below ~25°, ramping in as the camera lies down.
      const pitch = map.getPitch()
      const t = Math.max(0, Math.min(1, (pitch - 25) / (85 - 25)))
      // eased so it arrives gently rather than switching on
      el.style.opacity = String(t * t * (3 - 2 * t))
    }

    sync()
    map.on('move', sync)
    map.on('pitch', sync)
    return () => {
      map.off('move', sync)
      map.off('pitch', sync)
    }
  }, [map])

  return <div className="atmosphere" ref={ref} aria-hidden="true" />
}
