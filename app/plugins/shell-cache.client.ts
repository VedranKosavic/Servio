/**
 * Throw away the previous build's pages, once, on the first load of a new one.
 *
 * **What this is guarding.** The service worker keeps a copy of the HTML of
 * every screen the phone has opened (`sank-shell`, `nuxt.config.ts`), so that
 * an offline reload of `/konobar/razgovor/svi` comes back on that screen rather
 * than on the floor plan. Those copies are per build: the script tags inside
 * them name hashed files like `/_nuxt/Bq3f9x2a.js`, and the next build's files
 * have different names.
 *
 * **Workbox will not do this one for us**, and the distinction is the point.
 * Precached files are stored with a revision, so activating a new worker
 * replaces them. A *runtime* cache like `sank-shell` is keyed by URL alone:
 * last build's `/konobar/razgovor/svi` survives the swap untouched and is
 * handed out the next time the network takes longer than three seconds — a
 * document naming script files the activation has just deleted. Left alone that
 * is a phone stuck between two builds, which is the shape of the bug this file
 * belongs to: an old login screen posting a body today's API refuses, read by
 * the waiter as *"PIN nije prepoznat"*.
 *
 * **Why from the page and not from the worker.** `generateSW` writes the worker
 * from configuration, and the one rule `nuxt.config.ts` sets for it is that
 * nobody hand-writes worker code — a cache bug inside a service worker is
 * invisible from every screen. The page, on the other hand, knows the build it
 * is running (`buildId`) and can open the same cache by name. Four lines here
 * beat a custom worker.
 *
 * It runs once per load, costs one `localStorage` read on the ordinary load
 * where nothing changed, and is a no-op in any browser without `caches`.
 */
import { SHELL_CACHE } from '#shared/pwa'

/** Which build last wrote the page cache. Not a session thing: it outlives one. */
const BUILD_KEY = 'sank:shell-build'

export default defineNuxtPlugin(() => {
  const buildId = useRuntimeConfig().app.buildId
  if (!buildId || typeof caches === 'undefined') return

  // Deliberately not awaited: nothing on any screen waits for this, and a
  // browser that refuses storage must cost the app nothing at all.
  void (async () => {
    try {
      if (localStorage.getItem(BUILD_KEY) === buildId) return
      await caches.delete(SHELL_CACHE)
      localStorage.setItem(BUILD_KEY, buildId)
    } catch {
      // Private mode, storage disabled, or no Cache Storage. The worst case is
      // the old behaviour — a page cache that outlives its build — and the
      // network still answers first on every navigation.
    }
  })()
})
