import tailwindcss from '@tailwindcss/vite'
// The wordmark and the browser-chrome colours, from the one file that holds
// them. The config is read before Nuxt's auto-imports exist, so this is the
// one place they are imported by path.
import { APP_DESCRIPTION, APP_NAME, THEME_COLOR_DARK } from './shared/brand'
import { SHELL_CACHE } from './shared/pwa'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: ['@pinia/nuxt', '@vueuse/nuxt', '@vite-pwa/nuxt'],

  /**
   * The installable app (PHASE3 §2.4).
   *
   * **What a service worker is.** A small script the browser keeps running
   * beside the page, which every network request passes through first. That is
   * what lets an installed app open with no signal at all: the worker answers
   * from a copy of the built files it saved at install time (the *precache*).
   *
   * It is also the single most dangerous thing in this repo to get wrong, which
   * is why the runtime rules below are two lines and no more.
   */
  pwa: {
    // `generateSW` — Workbox writes the worker from this config. The
    // alternative, `injectManifest`, means hand-writing one, and a hand-written
    // worker is a cache bug nobody can see.
    strategies: 'generateSW',
    // `prompt`, not `autoUpdate`: a new build must never swap itself in under a
    // waiter mid-round. The app asks, and only between orders (see
    // `WaiterUpdatePrompt.vue`).
    registerType: 'prompt',
    manifest: {
      name: APP_NAME,
      short_name: APP_NAME,
      description: APP_DESCRIPTION,
      lang: 'bs',
      display: 'standalone',
      orientation: 'portrait',
      // Not '/': the lock screen sends everybody to their own home anyway, and
      // starting at the waiter app is right for the phones that install this.
      start_url: '/konobar',
      scope: '/',
      background_color: THEME_COLOR_DARK,
      theme_color: THEME_COLOR_DARK,
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        // `maskable` lets Android crop the icon into whatever shape the
        // launcher uses without eating the drawing; the mark is drawn well
        // inside the safe circle for exactly this.
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      /**
       * **`cleanupOutdatedCaches` is deliberately not set here**, and the
       * reason is measured rather than assumed.
       *
       * It looks like the answer to a phone serving an old bundle, and it is
       * not. Workbox already replaces a build: every precached file carries a
       * revision, and activating a new worker drops the entries whose revision
       * moved. The old bundle survived because with `registerType: 'prompt'`
       * below the new worker never *activated* — it installed, waited, and the
       * only thing that could let it in was a card on two waiter screens. That
       * is fixed in `useAppUpdate().applyWhenIdle()`, on the lock screen.
       *
       * What the flag actually does is delete precaches written by an older
       * *Workbox* version, whose storage format the current one cannot read —
       * and it does it inside the worker's `activate` event, which every client
       * waits on. Turning it on made `phase4-razgovor`'s offline photo check
       * fail in three runs out of six, each of those runs taking three times as
       * long; four runs with it off, everything else identical, were green and
       * fast, as were six on the unmodified base. A one-line tidy-up is not
       * worth a worker that sometimes takes half a minute to take over.
       */
      // `html` is on this list for one reason: `navigateFallback` can only
      // serve a page the worker actually has, and this app is server-rendered,
      // so the only HTML in `.output/public` is what `nitro.prerender` below
      // put there — `/konobar`, the shell.
      globPatterns: ['**/*.{js,css,html,woff2,svg,png,webmanifest}'],
      /**
       * Workbox's own navigation fallback is **switched off**, on purpose.
       *
       * `navigateFallback` registers a route that answers *every* navigation
       * out of the precache — online included. That is right for a pure SPA and
       * wrong here: this app is server-rendered, so a waiter opening
       * `/konobar/instalacija` would be handed the `/konobar` shell and stay
       * looking at the floor plan. (That is not hypothetical; it is what the
       * first run of `tests/e2e/wp0-offline.spec.ts` caught.)
       *
       * The module insists on registering the route, so it is pointed at a URL
       * that really is precached and given an **empty allowlist**, which means
       * it never matches anything. The first `runtimeCaching` rule below does
       * the same job properly: network first, the shell only when the network
       * is not there.
       */
      navigateFallback: '/konobar',
      navigateFallbackAllowlist: [],
      runtimeCaching: [
        {
          /**
           * A whole page load (a cold start, or a reload). Online it goes to
           * the server, because the HTML is rendered per request. Offline the
           * copy from the last visit answers, and if there is no copy — a table
           * this phone has not opened tonight — the precached `/konobar` shell
           * does, and Vue Router resolves the real route on the phone.
           */
          urlPattern: ({ request, url }: { request: Request, url: URL }) =>
            request.mode === 'navigate'
            && !url.pathname.startsWith('/api/')
            && !url.pathname.startsWith('/admin'),
          handler: 'NetworkFirst',
          options: {
            /**
             * One HTML document per URL the phone has opened — and **every one
             * of them belongs to the build that wrote it**, because the script
             * tags inside name that build's hashed files.
             *
             * The cache has to stay: without it an offline reload of
             * `/konobar/razgovor/svi` is answered with the precached `/konobar`
             * shell and the waiter is left looking at the floor plan instead of
             * the screen he was on (the `navigateFallback` note above is the
             * same fact from the other side).
             *
             * What must not stay is a document from a build that is gone —
             * and this is the one cache Workbox does **not** clean up for us.
             * Precached files carry a revision and are replaced when the new
             * worker activates; a runtime cache is keyed by URL alone, so last
             * build's `/konobar/razgovor/svi` survives the swap and is handed
             * out whenever the three seconds below run out. That is a stale
             * version served on a slow connection, pointing at script files the
             * activation has already deleted. So this cache is emptied once per
             * build, from the page rather than from the worker:
             * `app/plugins/shell-cache.client.ts`, which compares Nuxt's
             * `buildId` with the one that last wrote it.
             */
            cacheName: SHELL_CACHE,
            networkTimeoutSeconds: 3,
            plugins: [{
              // `ignoreSearch`, because a precached entry is stored under its
              // URL plus a `__WB_REVISION__` query the app never asks for.
              handlerDidError: async () => caches.match('/konobar', { ignoreSearch: true }),
            }],
          },
        },
        {
          // The catalogue, and the only read allowed to come from a cache. It
          // is the same for everybody in the venue and it changes when
          // `menu_version` moves, so a three-second-old copy is never wrong
          // about anybody's money.
          urlPattern: ({ url }) => url.pathname === '/api/bootstrap',
          handler: 'NetworkFirst',
          options: {
            cacheName: 'sank-bootstrap',
            networkTimeoutSeconds: 3,
            cacheableResponse: { statuses: [200] },
          },
        },
        {
          /**
           * **Everything else under /api/ is NetworkOnly, and this is not a
           * preference.** `server/middleware/tenant.ts` sends
           * `Cache-Control: private, no-cache` with `Vary: Cookie` precisely so
           * that every read revalidates against the current person's cookie. A
           * worker that served a cached read would show Emir's numbers to Amar
           * on a shared tablet after a re-lock.
           */
          urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
          handler: 'NetworkOnly',
        },
      ],
    },
    client: {
      // The install prompt and `$pwa.needRefresh` come from this plugin.
      installPrompt: true,
    },
    devOptions: {
      // Off in dev: a worker caching a Vite module graph that changes on every
      // save is an afternoon of phantom bugs. `npm run build` is where the
      // worker is real, and where §5.2 check 8 tests it.
      enabled: false,
      type: 'module',
    },
  },

  /**
   * The old one-letter prefixes, kept alive as redirects.
   *
   * The pages moved to `/konobar`, `/sanker` and `/admin`, but a phone that
   * installed the app before the move still has `/k` in its home-screen
   * shortcut, and every bookmark and pasted link out there is still short.
   *
   * **What a route rule is.** A table Nitro consults *before* any page or API
   * handler runs, matched on the path. `redirect` answers with a 307 and a
   * `Location:` header, so the browser asks again for the new address — the
   * user sees the new URL and nothing in the app has to know about the old one.
   *
   * `'/k/**'` means "`/k` and everything under it"; the `'/konobar/**'` target
   * pastes the rest of the path back on, so `/k/sto/3?kat=4` lands on
   * `/konobar/sto/3?kat=4`. The plain `'/k'` rule beside it is not redundant:
   * the exact match wins over the wildcard and keeps the query string without
   * the trailing slash the splat would leave behind.
   *
   * Only whole first segments match, so `/api/**` and `/stanje` are untouched.
   */
  routeRules: {
    '/k': { redirect: '/konobar' },
    '/k/**': { redirect: '/konobar/**' },
    '/s': { redirect: '/sanker' },
    '/s/**': { redirect: '/sanker/**' },
    '/a': { redirect: '/admin' },
    '/a/**': { redirect: '/admin/**' },
  },

  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },

  // Snajper owns port 3000. With an explicit port the dev server fails loudly
  // if 3100 is taken instead of silently hopping to the next free one.
  devServer: { port: 3100 },

  app: {
    head: {
      htmlAttrs: { lang: 'bs' },
      // Paints the browser's own chrome (Android address bar, the status bar of
      // an installed PWA) in the app background, so the page does not end at a
      // white strip.
      meta: [
        { name: 'theme-color', content: THEME_COLOR_DARK },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: APP_NAME },
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        /**
         * The pairing (docs/DESIGN.md §1), loaded once for the whole app.
         *
         * **Bricolage Grotesque** — the wordmark, page titles and big numbers.
         * `opsz` is an optical-size axis: the face tightens its spacing and
         * thins its joins as it grows, so a 40 px wordmark is drawn for 40 px
         * rather than being a blown-up UI font.
         *
         * **IBM Plex Sans** — everything read rather than glanced at, and every
         * digit in the app: it has true tabular figures, which is the one thing
         * a product made almost entirely of money and quantities cannot do
         * without.
         *
         * `main.css` names real system fallbacks for both, so a phone that
         * cannot reach Google Fonts renders the same layout in the same sizes
         * rather than a broken one.
         */
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap',
        },
      ],
    },
  },

  /**
   * Server-only configuration, read from the environment at boot.
   *
   * Everything at the top level of `runtimeConfig` stays on the server; only
   * what is under `public` reaches the browser, and there is nothing there. The
   * empty strings are the defaults: Nuxt overrides each one from `NUXT_*` and
   * the plain names below are what `/opt/sank/.env` actually sets, which is why
   * the code reads `process.env` directly for these three. Declaring them here
   * is the documentation — one list of every secret the server may hold.
   *
   * `SESSION_SECRET` is deliberately absent (§10): sessions are random tokens
   * stored as sha256 and there is nothing to sign. The one secret is the PIN
   * pepper, and it never leaves the box.
   */
  runtimeConfig: {
    /** 32 random bytes. Changing it invalidates every stored PIN. */
    pinPepper: process.env.PIN_PEPPER ?? '',
    /** The address the outside world uses; deploy checks it against nginx. */
    publicUrl: process.env.PUBLIC_URL ?? '',
    /** '1' only behind `deploy/nginx.conf`, which overwrites the header (§5.4). */
    trustProxy: process.env.TRUST_PROXY ?? '',
  },

  nitro: {
    // better-sqlite3 is a native module: it must stay a real Node require
    // instead of being bundled into the server build.
    externals: { external: ['better-sqlite3'] },

    /**
     * One page is built to a static file at build time: `/konobar`, the waiter
     * shell.
     *
     * It costs nothing — everything on that screen is inside `<ClientOnly>` and
     * depends on a session cookie the build has no way to see, so the rendered
     * HTML is the same "Učitavanje…" the server would send anyway. What it buys
     * is the service worker's `navigateFallback`: a worker can only answer an
     * offline navigation with a page it already holds, and a server-rendered
     * route is not a page it holds.
     */
    prerender: { routes: ['/konobar'] },

    // Nitro's cron runner is still behind a flag.
    experimental: { tasks: true },

    /**
     * The three scheduled tasks, **in UTC** — `deploy/sank.service` sets
     * `TZ=UTC` so that these expressions mean the same thing on the VPS as they
     * do on a laptop, and every task that needs the café's wall clock derives it
     * through `shared/dates.ts`.
     *
     * They run inside this one Node process, the same as in dev; there is no
     * system crontab for them and there must not be one, because a second
     * process would be a second writer on the same SQLite file. (The *backup*
     * cron on the VPS is a different thing: it runs `sqlite3 .backup`, which
     * only reads.)
     *
     * The schedules are compiled into the build, not read from `.env` —
     * `deploy/deploy.sh` prints them out of the bundle for exactly that reason.
     */
    scheduledTasks: {
      // Hourly at :15 — flag a shift nobody closed, and at local 05:xx prune.
      '15 * * * *': ['nightly'],
      // Hourly at :35 — a no-op unless BACKUP_DIR is set, which the VPS does not.
      '35 * * * *': ['backup'],
    },
  },
})
