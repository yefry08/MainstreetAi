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

// The load itself needs a bound for the same reason the decode does, one step
// earlier: `onload` fires only if the browser finishes fetching AND rasterising
// the image, and neither is guaranteed. A connection that stalls mid-download
// never fires `onload` and never fires `error` either, so an unbounded await
// leaves the page on "decoding..." with no error, forever.
//
// Generous on purpose. The Barcelona basemap is 7.5 MB, which is a slow but
// entirely normal download on a phone; this is here to catch a dead transfer,
// not to punish a slow one. Failing loudly beats a spinner that never resolves,
// because a visible error tells the viewer to reload and a spinner does not.
export const LOAD_TIMEOUT_MS = 60000

export async function loadImage(src, {
  timeoutMs = DECODE_TIMEOUT_MS,
  loadTimeoutMs = LOAD_TIMEOUT_MS,
} = {}) {
  const img = new Image()
  img.decoding = 'async'

  let loadTimer = null
  try {
    await new Promise((resolve, reject) => {
      loadTimer = setTimeout(
        () => reject(new Error(
          `${src} did not finish loading after ${Math.round(loadTimeoutMs / 1000)}s`)),
        loadTimeoutMs)
      img.onload = resolve
      img.onerror = () => reject(new Error(`could not load ${src}`))
      img.src = src
    })
  } finally {
    if (loadTimer) clearTimeout(loadTimer)
  }

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
