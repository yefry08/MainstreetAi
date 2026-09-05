/**
 * Multi-provider LLM client, called straight from the browser.
 *
 * HOW THE USER'S KEY IS HANDLED, AND WHY IT MATTERS
 * The key is typed by the visitor and lives in React state for as long as the
 * tab is open. It is never written to localStorage, sessionStorage, a cookie,
 * an IndexedDB store or a URL, and it is never sent anywhere except to the
 * provider the visitor picked. This site is static -- there is no backend of
 * ours for it to reach even by accident.
 *
 * That is a deliberate design, not an oversight. A key in localStorage
 * survives the tab, and anything that can run script on the page afterwards
 * can read it. Holding it in memory means closing the tab destroys it.
 *
 * What the visitor still has to accept, and what the UI says plainly: the key
 * does travel from their browser to their provider, so it is visible to any
 * browser extension with request access. The honest mitigation is a
 * short-lived or spend-capped key, which the UI recommends -- not a promise we
 * cannot keep.
 *
 * ALL FIVE PROVIDERS WERE CHECKED FOR BROWSER ACCESS BEFORE BEING OFFERED.
 * A provider that does not send CORS headers simply cannot be called from a
 * page, whatever the key: the fetch fails before the request is made. These
 * five answer an OPTIONS preflight from this origin. Anthropic additionally
 * requires an explicit opt-in header, which is included below.
 */

export const PROVIDERS = {
  gemini: {
    label: 'Google Gemini',
    hint: 'AIza…',
    models: ['gemini-2.0-flash', 'gemini-2.5-flash'],
    keys: 'https://aistudio.google.com/apikey',
  },
  openai: {
    label: 'OpenAI',
    hint: 'sk-…',
    models: ['gpt-4o-mini', 'gpt-4o'],
    keys: 'https://platform.openai.com/api-keys',
  },
  anthropic: {
    label: 'Anthropic',
    hint: 'sk-ant-…',
    models: ['claude-sonnet-4-5', 'claude-haiku-4-5-20251001'],
    keys: 'https://console.anthropic.com/settings/keys',
  },
  groq: {
    label: 'Groq',
    hint: 'gsk_…',
    models: ['llama-3.3-70b-versatile'],
    keys: 'https://console.groq.com/keys',
  },
  openrouter: {
    label: 'OpenRouter',
    hint: 'sk-or-…',
    models: ['anthropic/claude-sonnet-4.5', 'google/gemini-2.0-flash-001'],
    keys: 'https://openrouter.ai/keys',
  },
}

/** Shape one request per provider. Kept in one place so the call site is flat. */
function build(provider, { model, system, user, maxTokens }) {
  const m = model || PROVIDERS[provider].models[0]

  if (provider === 'gemini') {
    return {
      // The key goes in a header, never the query string: URLs end up in
      // history, referrers and proxy logs, and a key in one is a leaked key.
      url: `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': '<KEY>' },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 },
      },
      pick: (j) => j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '',
    }
  }

  if (provider === 'anthropic') {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': '<KEY>',
        'anthropic-version': '2023-06-01',
        // Without this the browser request is refused outright.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: { model: m, max_tokens: maxTokens, system, temperature: 0.4,
              messages: [{ role: 'user', content: user }] },
      pick: (j) => j?.content?.map((c) => c.text).join('') ?? '',
    }
  }

  // OpenAI, Groq and OpenRouter all speak the same chat-completions shape.
  const base = {
    openai: 'https://api.openai.com/v1/chat/completions',
    groq: 'https://api.groq.com/openai/v1/chat/completions',
    openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  }[provider]

  return {
    url: base,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer <KEY>' },
    body: { model: m, max_tokens: maxTokens, temperature: 0.4,
            messages: [{ role: 'system', content: system },
                       { role: 'user', content: user }] },
    pick: (j) => j?.choices?.[0]?.message?.content ?? '',
  }
}

/**
 * One completion. Throws with a message safe to show on screen.
 *
 * The key is substituted into the header at the last moment and the assembled
 * headers are never logged, so a stray console.log of the request cannot leak
 * it. Provider errors are re-thrown WITHOUT their body, because several
 * providers echo the offending key back in an auth failure.
 */
export async function complete(provider, key, { model, system, user, maxTokens = 700, signal }) {
  if (!PROVIDERS[provider]) throw new Error(`Proveedor desconocido: ${provider}`)
  if (!key) throw new Error('Falta la clave de API')

  const spec = build(provider, { model, system, user, maxTokens })
  const headers = Object.fromEntries(
    Object.entries(spec.headers).map(([k, v]) => [k, v.replace('<KEY>', key)]),
  )

  let res
  try {
    res = await fetch(spec.url, {
      method: 'POST', headers, body: JSON.stringify(spec.body), signal,
    })
  } catch (e) {
    if (e.name === 'AbortError') throw e
    throw new Error(`No se pudo contactar con ${PROVIDERS[provider].label}. ` +
                    'Revisa tu conexión o si una extensión bloquea la petición.')
  }

  if (!res.ok) {
    // Deliberately not res.text(): an auth error from several providers quotes
    // the key that failed, and that would put it on screen and in the console.
    const known = {
      401: 'Clave rechazada (401). Comprueba que es correcta y está activa.',
      403: 'Acceso denegado (403). La clave puede no tener permiso para este modelo.',
      404: 'Modelo no encontrado (404). Prueba otro modelo del proveedor.',
      429: 'Límite de uso alcanzado (429). Espera un momento o revisa tu cuota.',
    }
    throw new Error(known[res.status] ??
      `${PROVIDERS[provider].label} respondió ${res.status}.`)
  }

  const text = spec.pick(await res.json())
  if (!text) throw new Error('El proveedor respondió sin contenido.')
  return text
}

/** Pull the first JSON object out of a reply that may be wrapped in prose. */
export function parseJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = (fenced ? fenced[1] : text).trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('La IA no devolvió JSON.')
  return JSON.parse(raw.slice(start, end + 1))
}

/** A cheap round trip that proves the key works before the real run starts. */
export async function verifyKey(provider, key, model, signal) {
  const out = await complete(provider, key, {
    model,
    system: 'Responde solo con la palabra OK.',
    user: 'Di OK.',
    maxTokens: 16,
    signal,
  })
  return /ok/i.test(out)
}
