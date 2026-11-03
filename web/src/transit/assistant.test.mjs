/**
 * The route-review assistant's grounding. Run: node src/transit/assistant.test.mjs
 * No model is called: this pins the evidence it is given and the check on what
 * it cites.
 */
import { buildEvidence, userPrompt, checkCitations } from './assistant.js'

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `   ${detail}` : ''}`)
  if (!ok) failures++
}

const data = {
  city: 'Pristina', generated: '2026-11-03T12:00:00Z',
  totals: { homes: 1000, stops: 50, coveredShare: 0.78, walkM: 400, cellM: 250, minHomes: 15, flaggedHomes: 120 },
  gaps: [
    { lat: 42.63924, lon: 21.21283, homes: 105, nearestM: 548, nearestStop: { name: null }, area: { name: 'Mati 1' } },
    { lat: 42.67747, lon: 21.15491, homes: 15, nearestM: 425, nearestStop: { name: 'Sharbanët' }, area: null },
  ],
  routes: [{ id: 'relation/9', ref: '3A', name: 'Trafiku Urban 3A (Matiqan-Kodra e Trimave)', operator: null }],
}
const ev = buildEvidence(data)
check('totals, every gap and every route are numbered', ev.has('T') && ev.has('G1') && ev.has('G2') && ev.has('R1') && ev.size === 4)
check('a gap names its neighbourhood and distance', /Mati 1/.test(ev.get('G1').text) && /548 m/.test(ev.get('G1').text))
check('an unnamed area says so rather than inventing one', /unnamed place/.test(ev.get('G2').text))
check('records link to OpenStreetMap', ev.get('R1').osm.endsWith('relation/9') && ev.get('G1').osm.includes('42.63924'))
check('the cap limits gaps, never routes', buildEvidence(data, 1).has('G2') === false && buildEvidence(data, 1).has('R1'))

const p = userPrompt('  Where are the gaps?  ', ev)
check('the prompt carries every record and the question', p.includes('[G2]') && p.includes('[R1]') && p.endsWith('Where are the gaps?'))

const r = checkCitations('The largest gap is near Mati 1 [G1], served by line 3A [R1][G9].', ev)
check('real citations pass', r.cited.join() === 'G1,R1')
check('an invented citation is caught, not dropped', r.unknown.join() === 'G9' && r.parts.some((x) => x.cite === 'G9' && !x.ok))
check('text is preserved around citations', r.parts.map((x) => x.text ?? `[${x.cite}]`).join('') ===
  'The largest gap is near Mati 1 [G1], served by line 3A [R1][G9].')
check('a reply with no citations has none', checkCitations('No evidence on that.', ev).cited.length === 0)

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
