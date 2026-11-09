/**
 * Hour-by-hour congestion forecast. Run: node src/predict/forecast.test.mjs
 */
import { predictDay, predictHour } from './forecast.js'

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `   ${detail}` : ''}`)
  if (!ok) failures++
}

const pred = {
  signals: [{ id: 'A', name: 'Av. Churchill' }, { id: 'B', name: 'Av. Sarasota' }],
  generators: [
    { id: 'way/1', kind: 'school_private', name: 'Colegio X', people: 450, signals: [[0, 0.75], [1, 0.25]] },
    { id: 'way/2', kind: 'office', name: 'Torre Y', people: 400, signals: [[1, 1]] },
    { id: 'way/3', kind: 'stadium', name: 'Estadio Quisqueya', people: 10000, signals: [[1, 1]] },
  ],
}
const p13 = predictHour(pred, { day: 2, hour: 13 })
check('at 13h the colegio is the only source', p13.active.length === 1 && p13.active[0].gen.name === 'Colegio X')
check('its cars split over its junctions by weight', Math.abs(p13.hotspots[0].cars / p13.hotspots[1].cars - 3) < 1e-6)
check('the worst junction names its cause', p13.hotspots[0].signal.id === 'A' && p13.hotspots[0].reasons[0].name === 'Colegio X')
check('departures are marked as such', p13.active[0].dir === 'out')
const p17 = predictHour(pred, { day: 2, hour: 17 })
check('17h on a weekday: offices empty', p17.active.some((a) => a.gen.name === 'Torre Y' && a.dir === 'out'))
const game = predictHour(pred, { day: 5, hour: 18, game: true })
check('a game night makes the stadium junction the hotspot', game.hotspots[0].signal.id === 'B' && game.total > 2000, `${Math.round(game.total)} cars`)
check('rain raises the forecast', predictHour(pred, { day: 2, hour: 13, rain: 1 }).total > p13.total)
const day = predictDay(pred, { day: 2 })
check('the day has a morning and an afternoon peak', day[7] > day[10] && day[17] > day[15], day.map((v) => Math.round(v)).join(' '))

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
