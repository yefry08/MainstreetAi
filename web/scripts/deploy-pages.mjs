/**
 * Build the static site and publish it to the gh-pages branch.
 *
 *   npm run deploy               build, check, publish
 *   npm run deploy -- --dry-run  build, check, show what would change; push nothing
 *
 * WHY THIS EXISTS
 * Deploys used to be done by hand: check out gh-pages over the working copy,
 * copy web/dist on top, `git add`, push. Each step was a chance to go wrong,
 * and two of them did:
 *
 *   1. A build without VITE_REPLAY_ONLY shipped a page that waited forever for
 *      a WebSocket that cannot exist on GitHub Pages -- a city with no traffic.
 *      An absolute base path shipped a completely black page.
 *   2. A `git add -A` on gh-pages, which shares the working directory with
 *      main, published 5,850 files: source, node_modules, and .env with two
 *      live API keys, served publicly at /.env.
 *
 * So this script never checks gh-pages out over the working copy. It builds,
 * refuses to publish a build with either known defect, then publishes from a
 * SEPARATE git worktree in the temp directory that contains nothing but the
 * build output. There is no file on that tree that could be swept up by
 * accident, because nothing else was ever put there.
 *
 * It also refuses to run from a dirty tree or a branch other than main, so
 * what is live is always a commit you can name.
 */
import { execFileSync, execSync } from 'node:child_process'
import {
  cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = join(WEB, '..')
const DIST = join(WEB, 'dist')
const BRANCH = 'gh-pages'
const SITE = 'https://yefry08.github.io/MainstreetAi/'

const dryRun = process.argv.includes('--dry-run')
const allowBranch = process.argv.includes('--allow-branch')

// Kept on gh-pages even though the build does not produce them.
const KEEP = ['.nojekyll', 'README.md']

const GH_PAGES_GITIGNORE = `# gh-pages holds ONLY the built site (the contents of web/dist).
# Written by web/scripts/deploy-pages.mjs. Never deploy by hand: a 'git add -A'
# here once published .env and 5,800 files of source and node_modules.
.env
.env.*
web/
sim/
server/
node_modules/
`

const step = (msg) => console.log(`\n▸ ${msg}`)
const fail = (msg) => { console.error(`\n✗ ${msg}\n  Nothing was published.`); process.exit(1) }

const git = (args, cwd = REPO) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

// A fixed command string through the shell: npm is a .cmd shim on Windows,
// which execFile cannot launch, and passing an args array alongside
// shell:true is deprecated because the args are not escaped. Nothing here is
// user input, so a literal string is both portable and safe.
const npmRun = (script) => execSync(`npm run ${script}`, { cwd: WEB, stdio: 'inherit' })

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

// ---------------------------------------------------------------- 1. preflight
step('Preflight')
const branch = git(['branch', '--show-current'])
if (branch !== 'main' && !allowBranch) {
  fail(`On branch '${branch}'. Deploy from main so the live site is a commit you can name ` +
       '(or pass --allow-branch to preview something else).')
}
const dirty = git(['status', '--porcelain'])
if (dirty) fail(`Uncommitted changes:\n${dirty}\nCommit or stash them first.`)
const sha = git(['rev-parse', '--short', 'HEAD'])
console.log(`  ${branch} @ ${sha}`)

// ---------------------------------------------------------------- 2. build
step('Building (vite build --mode pages)')
rmSync(DIST, { recursive: true, force: true })
npmRun('build:pages')

// ---------------------------------------------------------------- 3. checks
step('Checking the build')
const index = readFileSync(join(DIST, 'index.html'), 'utf8')
const files = walk(DIST)

// The black page: absolute asset paths resolve to the domain root on a
// project page (yefry08.github.io/assets/...) and 404.
if (/(src|href)="\/assets\//.test(index)) {
  fail('index.html references /assets/ absolutely. The base path must be ./ for GitHub Pages ' +
       '(see vite.config.js: it derives from VITE_REPLAY_ONLY).')
}
// The city with no traffic: replay mode injects these preloads and nothing else
// does, so their absence means the build will wait for a server.
if (!index.includes('replay/manifest.json')) {
  fail('This build is not in replay mode (VITE_REPLAY_ONLY missing), so the deployed page ' +
       'would wait for a simulation server that does not exist and show no traffic.')
}
for (const f of ['replay/manifest.json', 'replay/ai.veh.bin', 'replay/ai.sig.bin',
                 'data/buildings.geojson', 'cities/madrid.json']) {
  if (!existsSync(join(DIST, f))) fail(`Missing from the build: ${f}`)
}

// Nothing secret may be in what is about to become public. Check by name, and
// by content against the actual values in the local .env -- a key pasted into
// a source file would otherwise ship inside a bundle.
const badName = files.find((f) => /(^|[\\/])\.env(\.|$)/.test(relative(DIST, f)))
if (badName) fail(`Refusing to publish ${relative(DIST, badName)}`)

const secrets = existsSync(join(REPO, '.env'))
  ? readFileSync(join(REPO, '.env'), 'utf8').split(/\r?\n/)
      .map((l) => l.match(/^\s*[A-Z0-9_]*(KEY|TOKEN|SECRET)[A-Z0-9_]*\s*=\s*(.+?)\s*$/i)?.[2])
      .filter((v) => v && v.length >= 12)
  : []
for (const f of files) {
  if (/\.(png|jpe?g|webp|bin|woff2?)$/i.test(f)) continue
  const text = readFileSync(f, 'utf8')
  if (secrets.some((s) => text.includes(s))) {
    fail(`${relative(DIST, f)} contains a value from your .env. Remove it from the source.`)
  }
}
const mb = files.reduce((s, f) => s + statSync(f).size, 0) / 1e6
console.log(`  ok: relative paths, replay mode, ${files.length} files, ${mb.toFixed(1)} MB, ` +
            `no .env values (${secrets.length} checked)`)

// ---------------------------------------------------------------- 4. publish
step(`Publishing to ${BRANCH} from a separate worktree`)
git(['fetch', '-q', 'origin', BRANCH])
const wt = mkdtempSync(join(tmpdir(), 'mainstreetai-pages-'))
// A throwaway local branch at origin/gh-pages, so this never depends on (or
// moves) whatever the local gh-pages branch happens to point at.
const tmpBranch = `deploy-${Date.now()}`
git(['worktree', 'add', '-q', '-b', tmpBranch, wt, `origin/${BRANCH}`])

try {
  // Start from empty, so files from old builds (stale hashed bundles) go away
  // instead of piling up on the branch forever.
  for (const name of readdirSync(wt)) {
    if (name === '.git' || KEEP.includes(name)) continue
    rmSync(join(wt, name), { recursive: true, force: true })
  }
  cpSync(DIST, wt, { recursive: true })
  if (!existsSync(join(wt, '.nojekyll'))) writeFileSync(join(wt, '.nojekyll'), '')
  writeFileSync(join(wt, '.gitignore'), GH_PAGES_GITIGNORE)

  // `add -A` is safe HERE and only here: this tree was built from nothing but
  // web/dist and the two kept files above.
  git(['add', '-A'], wt)
  const changes = git(['diff', '--cached', '--name-status'], wt)
  if (!changes) {
    console.log('  Nothing changed since the last deploy.')
  } else {
    const lines = changes.split('\n')
    const count = (c) => lines.filter((l) => l.startsWith(c)).length
    console.log(`  ${count('A')} added, ${count('M')} modified, ${count('D')} removed`)
    if (dryRun) {
      console.log('\n  --dry-run: not committing or pushing. Changes:')
      console.log(lines.slice(0, 40).map((l) => `    ${l}`).join('\n') +
                  (lines.length > 40 ? `\n    … ${lines.length - 40} more` : ''))
    } else {
      git(['commit', '-q', '-m', `Deploy ${sha} from main\n\nBuilt and published by web/scripts/deploy-pages.mjs.`], wt)
      git(['push', '-q', 'origin', `HEAD:${BRANCH}`], wt)
      console.log(`  pushed ${git(['rev-parse', '--short', 'HEAD'], wt)} to ${BRANCH}`)
    }
  }
} finally {
  git(['worktree', 'remove', '--force', wt])
  git(['branch', '-q', '-D', tmpBranch])
}

if (!dryRun) {
  const bundle = index.match(/assets\/(index-[\w-]+\.js)/)?.[1]
  console.log(`\n✓ Deployed ${sha}. GitHub Pages usually updates within a minute or two.`)
  console.log(`  ${SITE}  (look for ${bundle} in the page source)`)
}
