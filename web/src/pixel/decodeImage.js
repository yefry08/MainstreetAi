/**
 * Load an image and pre-decode it, but never hang on the decode.
 *
 * WHY THE TIMEOUT EXISTS
 * img.decode() is an optimisation: it moves the decode off the first paint so
 * drawImage does not jank. It is NOT required for correctness -- once `load`
 * has fired the image is already legal to draw, and the browser will decode it
 * lazily on first use.
 *
 * That distinction matters because decode() can never settle at all. In a tab
 * that is not compositing (a background tab, a headless pane, a minimised
 * window) the decode is queued behind a rasteriser that is not running, and the
 * promise stays pending forever. Measured here on the 5078x5078 Barcelona
 * basemap: load fired in 1 ms, decode was still pending after 5.4 s.
 *
 * `await img.decode()` with a try/catch does not save you, because a promise
 * that never settles is not a rejection -- there is nothing to catch. The
 * scene just stops, with no error, showing "decoding..." until the tab closes.
 * A silent permanent hang is a worse failure than a crash: during a demo it is
 * indistinguishable from a dead page.
 *
 * So the decode is raced against a deadline and its result is discarded either
 * way. Worst case we lose a frame of smoothness on first paint. Best case we
 * do not lose the whole scene.
 */
export const DECODE_TIMEOUT_MS = 3000

export async function loadImage(src, { timeoutMs = DECODE_TIMEOUT_MS } = {}) {
  const img = new Image()
  img.decoding = 'async'

  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = () => reject(new Error(`could not load ${src}`))
    img.src = src
  })

  // Past this point the image is drawable, so every failure mode below is
  // non-fatal and deliberately swallowed.
  let timer = null
  let timedOut = false
  try {
    await Promise.race([
      img.decode ? img.decode() : Promise.resolve(),
      new Promise((r) => { timer = setTimeout(() => { timedOut = true; r() }, timeoutMs) }),
    ])
  } catch {
    /* decode() rejects on some older browsers for images it can still draw */
  } finally {
    if (timer) clearTimeout(timer)
  }

  return { img, decodeTimedOut: timedOut }
}
