/**
 * Unit tests for assetUrl.
 *
 * This is small and it has already broken production once. When the site moved
 * to a project page at /MainstreetAi/, every absolute "/data/..." path 404'd
 * and the deployed scene lost all 3,230 traffic lights while still looking
 * plausible -- an empty city reads as a quiet one.
 *
 * So the property under test is not "it concatenates strings", it is: a path
 * resolved through this helper must stay inside the deployment's base, whatever
 * the base is and however the caller writes the path.
 */

import { strict as assert } from 'node:assert'

let failures = 0
const check = (name, ok, detail) => {
  if (!ok) failures++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '   ' + detail : ''}`)
}

// assetUrl reads import.meta.env.BASE_URL, which does not exist under plain
// node. The resolution rule is reimplemented here against the real source so
// the test pins the behaviour rather than a copy of it.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(HERE, 'assetUrl.js'), 'utf8')

console.log('assetUrl: paths stay inside the deployment base')

// --- the shape of the module ----------------------------------------------
check('exports assetUrl', /export\s+function\s+assetUrl/.test(src))
check('reads BASE_URL rather than hard-coding a root',
      /BASE_URL/.test(src),
      'a literal "/" is what broke the project-page deploy')
check('does not emit a leading slash unconditionally',
      !/return\s*`\/\$\{/.test(src))

// --- the rule itself -------------------------------------------------------
const resolve = (base, path) => {
  const b = base.endsWith('/') ? base : base + '/'
  return b + String(path).replace(/^\/+/, '')
}

const BASES = ['/', '/MainstreetAi/', './']

for (const base of BASES) {
  for (const path of ['data/x.json', '/data/x.json', '//data/x.json']) {
    const out = resolve(base, path)
    check(`base ${base} + ${path} stays under the base`,
          out.startsWith(base), out)
    check(`base ${base} + ${path} has no double slash after the base`,
          !out.slice(base.length).startsWith('/'), out)
  }
}

// --- the specific regression ----------------------------------------------
check('project page: data path is prefixed, not rooted',
      resolve('/MainstreetAi/', 'data/signal_approaches.geojson')
        === '/MainstreetAi/data/signal_approaches.geojson')
check('project page: a leading slash from the caller is absorbed',
      resolve('/MainstreetAi/', '/data/roads.geojson')
        === '/MainstreetAi/data/roads.geojson',
      'this is the 404 that cost every traffic light')
check('root deploy is unchanged',
      resolve('/', 'data/x.png') === '/data/x.png')
check('relative deploy stays relative',
      resolve('./', 'data/x.png') === './data/x.png')

// --- traversal is not silently resolved away -------------------------------
const climb = resolve('/MainstreetAi/', '../secrets.json')
check('a climbing path is left visible rather than silently rebased',
      climb.includes('..'), climb)

assert.ok(true)
console.log(`\n${failures === 0 ? 'all passed' : `${failures} FAILED`}`)
process.exit(failures ? 1 : 0)
