/**
 * The address-bar contract. Run: node src/data/route.test.mjs
 *
 * Links get shared; once one is out in the world, changing what it opens
 * breaks it for whoever has it. These pin the format.
 */
import { parseHash, toHash, parsePlaceParam, placeParam } from './route.js'

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `   ${detail}` : ''}`)
  if (!ok) failures++
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

check('empty hash is the landing page', eq(parseHash(''), { tab: 'landing', city: null }))
check('#/ is the landing page', eq(parseHash('#/'), { tab: 'landing', city: null }))
check('#/barcelona is the Barcelona tab (key "home")', parseHash('#/barcelona').tab === 'home')
check('#/manhattan', parseHash('#/manhattan').tab === 'manhattan')
check('an unknown path falls back to landing, not a blank page', parseHash('#/nope').tab === 'landing')
check('#/your-city/lima opens Lima', eq(parseHash('#/your-city/lima'), { tab: 'yours', city: 'lima' }))
check('a city param is ignored on other tabs', parseHash('#/barcelona/lima').city === null)

for (const [tab, city] of [['landing', null], ['home', null], ['yours', null], ['yours', 'sao-paulo'],
                           ['yours', '@-0.1807,-78.4678,Quito'], ['how', null], ['contact', null]]) {
  check(`round trip ${tab}${city ? ` / ${city}` : ''}`, eq(parseHash(toHash(tab, city)), { tab, city }))
}

const quito = { name: 'Quito', lat: -0.18071234, lon: -78.46789 }
check('placeParam rounds to 4 dp (~11 m)', placeParam(quito) === '@-0.1807,-78.4679,Quito')
const p = parsePlaceParam(placeParam(quito))
check('a place survives a round trip', p && p.name === 'Quito' && p.lat === -0.1807 && p.live === true)
check('a name with commas and accents survives', parsePlaceParam('@4.6,-74.08,Bogotá, D.C.')?.name === 'Bogotá, D.C.')
check('out-of-range coordinates are rejected', parsePlaceParam('@95,10,Nowhere') === null)
check('a non-place param is not mistaken for one', parsePlaceParam('lima') === null)
check('a hostile name is length-capped', parsePlaceParam(`@1,1,${'x'.repeat(5000)}`).name.length === 80)
check('a malformed escape does not throw', parseHash('#/your-city/%E0%A4%A').city === null)

console.log(`\n${failures === 0 ? 'all passed' : `${failures} FAILED`}`)
process.exit(failures ? 1 : 0)
