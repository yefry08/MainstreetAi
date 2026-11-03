/**
 * The route-review assistant: plain-language questions, answered only from
 * the baked evidence, every claim cited.
 *
 * The Pristina use case's MVP, as far as public data allows: "ask questions
 * in Albanian, Serbian or English ... receive a synthesised answer", "every
 * response links back to the original document, dataset or record", and the
 * tool "highlights locations ... without recommending or making changes".
 *
 * HOW IT STAYS HONEST
 *   - Retrieval is the whole evidence set, numbered: [T] the totals, [G1..]
 *     the flagged areas, [R1..] the bus routes. It is small (a city's flags
 *     and lines fit in a few thousand tokens), so nothing is left out by a
 *     ranking step the planner cannot see.
 *   - The model is told to answer only from those records, cite them, say
 *     when they do not answer the question, and never recommend a change.
 *   - checkCitations() then verifies every [id] in the reply against the
 *     records. A citation to something that does not exist is shown as such
 *     on screen, not silently dropped -- the planner sees the model slip.
 *
 * The model is the visitor's own (city/ai.js): key in memory only, sent
 * nowhere but their provider.
 */

export const MAX_GAPS = 60

/** Numbered evidence records from a baked transit file. */
export function buildEvidence(data, maxGaps = MAX_GAPS) {
  const t = data.totals
  const records = new Map()
  records.set('T', {
    kind: 'totals',
    text: `${data.city}: ${t.homes} homes and ${t.stops} bus stops in OpenStreetMap; ` +
      `${Math.round(t.coveredShare * 100)}% of homes are within ${t.walkM} m (straight line) of a stop; ` +
      `${data.gaps.length} areas of ${t.cellM} m with ${t.minHomes}+ homes and no stop within ${t.walkM} m, ` +
      `${t.flaggedHomes} homes in all. Data read ${data.generated.slice(0, 10)}.`,
  })
  data.gaps.slice(0, maxGaps).forEach((g, i) => {
    records.set(`G${i + 1}`, {
      kind: 'gap', index: i, osm: `https://www.openstreetmap.org/#map=17/${g.lat}/${g.lon}`,
      text: `area near ${g.area?.name ?? 'unnamed place'} (${g.lat}, ${g.lon}): ${g.homes} homes; ` +
        (g.nearestM != null
          ? `nearest stop ${g.nearestM} m away${g.nearestStop?.name ? ` (${g.nearestStop.name})` : ''}`
          : 'no stop found nearby'),
    })
  })
  data.routes.forEach((r, i) => {
    records.set(`R${i + 1}`, {
      kind: 'route', osm: `https://www.openstreetmap.org/${r.id}`,
      text: `bus line ${r.ref ?? '?'}: ${r.name ?? 'unnamed'}${r.operator ? `, operator ${r.operator}` : ''}`,
    })
  })
  return records
}

export const SYSTEM = `You are a research assistant for municipal public-transport planners.
Answer ONLY from the numbered evidence records you are given. After every factual
statement, cite the record(s) it comes from in square brackets, e.g. [G3] or [T][R2].
Never cite an id that is not in the evidence.
If the records do not answer the question, say so plainly and say what data would
(for example ridership counts, GPS or schedule data, resident complaints).
Do NOT recommend new routes, stops or changes: describe the evidence; planners decide.
Remember the evidence is OpenStreetMap: a missing stop may be a gap in the map, not
in the service, and distances are straight-line.
Reply in the language of the question (Albanian, Serbian, English or Spanish).
Be concise: at most about 150 words.`

export function userPrompt(question, records) {
  const lines = [...records.entries()].map(([id, r]) => `[${id}] ${r.text}`)
  return `EVIDENCE\n${lines.join('\n')}\n\nQUESTION\n${question.trim()}`
}

/**
 * Split a reply into text and citation parts, checking each id.
 * Returns {parts: [{text} | {cite: id, ok: bool}], cited: [ids], unknown: [ids]}.
 */
export function checkCitations(reply, records) {
  const parts = []
  const cited = new Set()
  const unknown = new Set()
  let last = 0
  for (const m of reply.matchAll(/\[([A-Z]\d*)\]/g)) {
    if (m.index > last) parts.push({ text: reply.slice(last, m.index) })
    const id = m[1]
    const ok = records.has(id)
    ;(ok ? cited : unknown).add(id)
    parts.push({ cite: id, ok })
    last = m.index + m[0].length
  }
  if (last < reply.length) parts.push({ text: reply.slice(last) })
  return { parts, cited: [...cited], unknown: [...unknown] }
}

/** Example questions in the four languages the page offers. */
export const EXAMPLES = [
  { lang: 'sq', q: 'Cilat zona kanë më shumë banesa pa stacion autobusi afër?' },
  { lang: 'sr', q: 'Koja područja imaju najviše stanova bez autobuske stanice u blizini?' },
  { lang: 'en', q: 'Which areas have the most homes with no bus stop within 400 m?' },
  { lang: 'es', q: '¿Qué líneas de bus pasan cerca de las zonas marcadas?' },
]
