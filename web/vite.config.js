import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Start the recording downloading while the HTML is still being parsed.
 *
 * WHY THIS IS WORTH A PLUGIN
 * The hero's traffic comes from replay/ai.*.bin, and nothing asks for those
 * files until the 400 KB main bundle has downloaded, parsed and executed. So
 * the two largest downloads on the page happen strictly one after the other
 * when they could overlap almost entirely -- the browser has a free connection
 * and no idea it is about to need 435 KB of vehicle traces.
 *
 * A preload hint in the HTML tells it. The fetch starts at parse time, runs
 * alongside the bundle, and is usually finished by the time the scene asks.
 *
 * Only injected into the static build. In the live build these files are not
 * fetched at all -- the traffic comes off a WebSocket -- and preloading
 * something never used wastes the bandwidth it was meant to save, on top of a
 * console warning.
 */
function preloadReplay(enabled) {
  return {
    name: 'preload-replay',
    transformIndexHtml() {
      if (!enabled) return []
      // Relative hrefs, so this survives being served from /MainstreetAi/.
      // `as: fetch` (not `image`/`script`) is what makes the preloaded bytes
      // reusable by a later fetch() rather than downloaded a second time.
      return ['replay/manifest.json', 'replay/ai.veh.bin', 'replay/ai.sig.bin']
        .map((href) => ({
          tag: 'link',
          attrs: { rel: 'preload', as: 'fetch', crossorigin: 'anonymous', href: `./${href}` },
          injectTo: 'head',
        }))
    },
  }
}

/**
 * ONE SWITCH DECIDES BOTH, ON PURPOSE.
 *
 * The static build needs two things together: it must play the recording rather
 * than open a WebSocket (VITE_REPLAY_ONLY), and it must reference its assets
 * relatively (base './'), because a GitHub project page lives at /MainstreetAi/
 * and an absolute /assets/... resolves to the domain root -- a 404 and a blank
 * page. Setting one without the other is what broke the deploy: a rebuild that
 * dropped the flag shipped a page that waited on a server that cannot exist,
 * and drew a city with no traffic in it.
 *
 * So the flag derives the base rather than being set beside it. There is no
 * combination of the two left to get wrong.
 *
 * The env is read from both places: `--mode pages` picks it up from .env.pages,
 * while sim/build_vercel.sh keeps working unchanged by passing it as a shell
 * variable. A shell variable wins only when it is non-empty -- several existing
 * build commands clear it with VITE_REPLAY_ONLY="" before a live build, and an
 * empty string overriding the mode file would silently disable replay again.
 */
export default defineConfig(({ mode }) => {
  const shell = process.env.VITE_REPLAY_ONLY
  const fromFile = loadEnv(mode, process.cwd(), 'VITE_').VITE_REPLAY_ONLY
  const replayOnly = (shell || fromFile) === '1'

  return {
    base: replayOnly ? './' : '/',
    plugins: [
      react(),
      preloadReplay(replayOnly),
    ],
    server: {
      port: 5173,
      proxy: {
        // The Python simulation server. Proxying keeps the browser on one origin
        // so the WebSocket needs no CORS dance.
        '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
        '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
      },
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 2000,
    },
  }
})
