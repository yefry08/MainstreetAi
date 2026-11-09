/**
 * Traffic generators. Run: node src/predict/generators.test.mjs
 */
import { KINDS, OCCUPANCY, hourly, kindOf, peopleAt, rainFactor } from './generators.js'

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `   ${detail}` : ''}`)
  if (!ok) failures++
}
const sum = (a) => a.reduce((s, x) => s + x, 0)

check('a "Colegio" is read as a private school', kindOf({ amenity: 'school', name: 'Colegio Babeque' }) === 'school_private')
check('an explicitly public school stays public', kindOf({ amenity: 'school', name: 'Liceo Juan Pablo Duarte', 'operator:type': 'public' }) === 'school_public')
check('a plain school is public', kindOf({ amenity: 'school', name: 'Escuela Básica República de Chile' }) === 'school_public')
check('stadium, mall, office, nothing', kindOf({ leisure: 'stadium' }) === 'stadium' && kindOf({ shop: 'mall' }) === 'mall' &&
  kindOf({ office: 'company' }) === 'office' && kindOf({ amenity: 'bench' }) === null)

const colegio = { kind: 'school_private', people: 450 }
const tue = hourly(colegio, { day: 2 })
const cars = (450 * KINDS.school_private.carShare) / OCCUPANCY
check('morning drop-off is all at 6-7h', Math.abs(tue.in[6] + tue.in[7] - cars) < 0.5 && tue.in[9] === 0, `${(tue.in[6] + tue.in[7]).toFixed(0)} cars`)
check('afternoon pick-up peaks at 13h', tue.out[13] > tue.out[12] * 0.9 && tue.out[13] > 0, tue.out.slice(12, 15).map((x) => x.toFixed(0)).join('/'))
check('no school on Sunday', sum(hourly(colegio, { day: 0 }).in) === 0)
check('rain puts more parents in cars', sum(hourly(colegio, { day: 2, rain: 1 }).out) > sum(tue.out) * 1.2)
check('the stadium is quiet without a game', sum(hourly({ kind: 'stadium', people: 10000 }, { day: 5 }).in) === 0)
check('a game night fills 17-19h', sum(hourly({ kind: 'stadium', people: 10000 }, { day: 5, event: true }).in) > 3000)

check('a capacity tag wins', peopleAt('school_private', { capacity: '1200' }, 500) === 1200)
check('a small office is small, a tower is big', peopleAt('office', {}, 200) < peopleAt('office', { 'building:levels': '20' }, 1500))
check('rain factor: 0 dry, 1 at 4 mm/h and above', rainFactor(0) === 0 && rainFactor(2) === 0.5 && rainFactor(10) === 1)

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
