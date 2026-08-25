/**
 * Every custom property referenced must actually be defined.
 *
 * An undefined CSS variable does not error. In `color:` it quietly inherits,
 * which is nearly invisible. In `background:` it resolves to transparent --
 * which is how the split meter, the signature element of this UI, came to
 * render its fixed-time baseline bar as nothing at all: panels.css carried a
 * comment explaining the careful choice of `--slate-300` over `--slate-400`,
 * and neither had ever been defined.
 *
 * That is a failure a screenshot catches only if you happen to look at the
 * right panel, and a test catches every time.
 *
 * Run:  node src/design/tokens.test.mjs
 */

import { readFileSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..')

let failures = 0
const check = (name, ok, detail) => {
  if (!ok) failures++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '   ' + detail : ''}`)
}

/** Every .css and .jsx file under src/. */
function walk(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.(css|jsx?)$/.test(e.name) && !e.name.endsWith('.test.mjs')) out.push(p)
  }
  return out
}

const files = walk(SRC)
const cssFiles = files.filter((f) => f.endsWith('.css'))

// Defined anywhere in the design layer.
const defined = new Set()
for (const f of cssFiles) {
  for (const m of readFileSync(f, 'utf8').matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)) {
    defined.add(m[1])
  }
}

// Referenced, split by whether the reference supplies its own fallback.
const referenced = new Map()   // token -> { file, hasFallback }
for (const f of files) {
  const text = readFileSync(f, 'utf8')
  for (const m of text.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,)?/g)) {
    const prev = referenced.get(m[1])
    const hasFallback = Boolean(m[2])
    // A token counts as safe only if EVERY reference supplies a fallback.
    referenced.set(m[1], {
      file: prev?.file ?? f.replace(SRC, 'src'),
      hasFallback: (prev?.hasFallback ?? true) && hasFallback,
    })
  }
}

console.log(`tokens defined: ${defined.size}   referenced: ${referenced.size}`)

const undefinedNoFallback = []
const undefinedWithFallback = []
for (const [tok, info] of referenced) {
  if (defined.has(tok)) continue
  ;(info.hasFallback ? undefinedWithFallback : undefinedNoFallback).push([tok, info.file])
}

check('every referenced token is defined or has a fallback',
  undefinedNoFallback.length === 0,
  undefinedNoFallback.map(([t, f]) => `${t} (${f})`).join(', '))

if (undefinedWithFallback.length) {
  console.log(`  note  ${undefinedWithFallback.length} undefined but with a ` +
    `fallback: ${undefinedWithFallback.map(([t]) => t).join(', ')}`)
}

// The specific regression: anything used as a bare `background` must exist,
// because there the failure mode is invisibility rather than inheritance.
const bgMisses = []
for (const f of cssFiles) {
  const text = readFileSync(f, 'utf8')
  for (const m of text.matchAll(/background(?:-color)?\s*:\s*var\(\s*(--[a-z0-9-]+)\s*\)/g)) {
    if (!defined.has(m[1])) bgMisses.push(`${m[1]} in ${f.replace(SRC, 'src')}`)
  }
}
check('no background: var() resolves to transparent',
  bgMisses.length === 0, bgMisses.join(', '))

// The meter is the signature element; both halves must be paintable.
check('split meter has both halves defined',
  defined.has('--slate-300') && defined.has('--terracota-500'))

// ---------------------------------------------------------------------------
// CONTRAST. This UI is dark, the type is small, and the stated venue is a
// conference projector — the least forgiving display there is. Measured in the
// live DOM, six labels were using --ink-700 at 2.06:1, including the map
// attribution link, and every --ink-500 label sat at 4.39:1, just under the
// 4.5:1 threshold. Neither is visible in a screenshot; both are arithmetic.
const tokensCss = readFileSync(join(HERE, 'tokens.css'), 'utf8')

function hexOf(name) {
  const m = tokensCss.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-f]{6})`, 'i'))
  return m ? m[1] : null
}
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16))
const lum = (c) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
}
// The measured backdrop of a glass panel over the night basemap.
const PANEL_BG = [12, 15, 22]
const contrast = (hex) => {
  const a = lum(rgb(hex)); const b = lum(PANEL_BG)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

// Tokens actually used as small text somewhere in the UI.
const TEXT_TOKENS = ['--ink-50', '--ink-100', '--ink-300', '--ink-400', '--ink-500',
                     '--slate-300', '--terracota-400', '--terracota-500']
const failing = []
for (const t of TEXT_TOKENS) {
  const hex = hexOf(t)
  if (!hex) { failing.push(`${t} undefined`); continue }
  const c = contrast(hex)
  if (c < 4.5) failing.push(`${t} ${hex} ${c.toFixed(2)}:1`)
}
check('every text token clears 4.5:1 on a glass panel', failing.length === 0,
  failing.join(', '))

// --ink-700 is a fill, not a text colour. If it ever creeps back into a
// `color:` rule the label it paints will be effectively invisible.
const inkSevenAsText = []
for (const f of cssFiles) {
  const text = readFileSync(f, 'utf8')
  if (/color\s*:\s*var\(\s*--ink-700/.test(text)) inkSevenAsText.push(f.replace(SRC, 'src'))
}
check('--ink-700 is never used as a text colour',
  inkSevenAsText.length === 0,
  `${inkSevenAsText.join(', ')} (${hexOf('--ink-700')} is ${contrast(hexOf('--ink-700')).toFixed(2)}:1)`)

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
