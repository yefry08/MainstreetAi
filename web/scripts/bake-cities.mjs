/**
 * Fetch every curated city's streets once, and ship them with the site.
 *
 *   node scripts/bake-cities.mjs            # bake whatever is missing
 *   node scripts/bake-cities.mjs --force    # re-fetch everything
 *   node scripts/bake-cities.mjs madrid lima
 *
 * Output: public/cities/<slug>.json, in the slim format from src/city/osm.js.
 *
 * WHY PATIENT
 * The public Overpass mirrors are often overloaded for minutes at a time. A
 * page cannot wait that long for a visitor; this script can. It retries each
 * city with a growing pause and never overwrites a city it already has unless
 * told to, so it can be stopped and re-run until everything is in.
 *
 * A city is only written if the page could actually run it -- the same
 * three-signal floor TryCity applies -- so a ready-made city can never be one
 * that fails on click.
 */
import { mkdirSync, existsSync, writeFileSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CITIES, bbox, citySlug } from '../src/city/cities.js'
import { fetchCity, buildGraph, slimOsm, expandOsm } from '../src/city/osm.js'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'cities')
mkdirSync(OUT, { recursive: true })

const args = process.argv.slice(2)
const force = args.includes('--force')
const names = args.filter((a) => !a.startsWith('--')).map((a) => a.toLowerCase())
const todo = CITIES.filter((c) => !names.length || names.some((n) => citySlug(c).includes(n)))

const PAUSES_S = [0, 20, 45, 90, 180, 300]
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000))

let ok = 0
const failed = []
for (const city of todo) {
  const slug = citySlug(city)
  const file = join(OUT, `${slug}.json`)
  if (!force && existsSync(file)) { console.log(`have   ${slug}`); ok++; continue }

  let done = false
  for (const [attempt, pause] of PAUSES_S.entries()) {
    if (pause) await sleep(pause)
    try {
      const osm = await fetchCity(bbox(city), {
        headers: { 'User-Agent': 'mainstreetai-bake/1.0 (github.com/yefry08/MainstreetAi)' },
        timeoutMs: 150000,
      })
      const slim = slimOsm(osm)
      // Validate the round trip, not just the download: what gets written is
      // what the page will parse.
      const g = buildGraph(expandOsm(slim), bbox(city))
      if (g.stats.signals < 3) {
        console.log(`skip   ${slug}: only ${g.stats.signals} signalised junctions`)
        failed.push(`${slug} (too few signals)`)
        done = true
        break
      }
      const tmp = `${file}.tmp`
      writeFileSync(tmp, JSON.stringify(slim))
      renameSync(tmp, file)
      console.log(`baked  ${slug}: ${g.stats.edges} streets, ${g.stats.signals} signals ` +
                  `(${g.stats.taggedSignals} tagged), ${(statSync(file).size / 1024).toFixed(0)} KB`)
      ok++
      done = true
      break
    } catch (e) {
      console.log(`retry  ${slug} (attempt ${attempt + 1}/${PAUSES_S.length}): ${e.message.slice(0, 140)}`)
    }
  }
  if (!done) failed.push(slug)
  // Be a polite client of a free service between cities.
  await sleep(3)
}

console.log(`\n${ok}/${todo.length} cities ready` +
            (failed.length ? `; missing: ${failed.join(', ')}` : ''))
process.exit(failed.length ? 1 : 0)
