import { assetUrl } from '../data/assetUrl'
import { checkModel } from './neural'

/**
 * Where the neural signal controller's weights come from.
 *
 * Hugging Face first: that is where the model is published (by the Colab
 * notebook in training/), and loading it from there means a retrained model
 * reaches visitors without redeploying the site.
 *
 * A copy ships with the site as the fallback. Hugging Face is a third-party
 * service, and this project's rule is that nothing on the page may fail
 * because one is slow or down -- the same reason the ready-made cities exist.
 * The page says which copy it used.
 *
 * Whatever arrives is validated (checkModel) before it controls anything: a
 * wrong shape becomes "no model" and the rule-based controller, never NaN
 * green times.
 */
export const HF_REPO = null       // e.g. 'your-username/mainstreetai-signal-controller'
const HF_TIMEOUT_MS = 6000

export const hfUrl = (repo) => `https://huggingface.co/${repo}/resolve/main/model.json`

async function fetchJson(url, ms) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ms)
  try {
    const res = await fetch(url, { signal: ac.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/** Resolves to { model, source, url } or null. Never throws. */
export async function loadSignalModel() {
  const sources = []
  if (HF_REPO) sources.push({ source: 'Hugging Face', url: hfUrl(HF_REPO), ms: HF_TIMEOUT_MS })
  sources.push({ source: 'site copy', url: assetUrl('models/signal-controller.json'), ms: 10000 })

  for (const s of sources) {
    try {
      return { model: checkModel(await fetchJson(s.url, s.ms)), source: s.source, url: s.url }
    } catch {
      /* try the next source */
    }
  }
  return null
}
