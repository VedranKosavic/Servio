import tailwindcss from '@tailwindcss/vite'

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
      name: 'Šank',
      short_name: 'Šank',
      description: 'Narudžbe, smjene i stanje šanka',
      lang: 'bs',
      display: 'standalone',
      orientation: 'portrait',
      // Not '/': the lock screen sends everybody to their own home anyway, and
      // starting at the waiter app is right for the phones that install this.
      start_url: '/k',
      scope: '/',
      background_color: '#0e0e12',
      theme_color: '#0e0e12',
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
      // `html` is on this list for one reason: `navigateFallback` can only
      // serve a page the worker actually has, and this app is server-rendered,
      // so the only HTML in `.output/public` is what `nitro.prerender` below
      // put there — `/k`, the shell.
      globPatterns: ['**/*.{js,css,html,woff2,svg,png,webmanifest}'],
      /**
       * Workbox's own navigation fallback is **switched off**, on purpose.
       *
       * `navigateFallback` registers a route that answers *every* navigation
       * out of the precache — online included. That is right for a pure SPA and
       * wrong here: this app is server-rendered, so a waiter opening
       * `/k/instalacija` would be handed the `/k` shell and stay looking at the
       * floor plan. (That is not hypothetical; it is what the first run of
       * `tests/e2e/wp0-offline.spec.ts` caught.)
       *
       * The module insists on registering the route, so it is pointed at a URL
       * that really is precached and given an **empty allowlist**, which means
       * it never matches anything. The first `runtimeCaching` rule below does
       * the same job properly: network first, the shell only when the network
       * is not there.
       */
      navigateFallback: '/k',
      navigateFallbackAllowlist: [],
      runtimeCaching: [
        {
          /**
           * A whole page load (a cold start, or a reload). Online it goes to
           * the server, because the HTML is rendered per request. Offline the
           * copy from the last visit answers, and if there is no copy — a table
           * this phone has not opened tonight — the precached `/k` shell does,
           * and Vue Router resolves the real route on the phone.
           */
          urlPattern: ({ request, url }: { request: Request, url: URL }) =>
            request.mode === 'navigate'
            && !url.pathname.startsWith('/api/')
            && !url.pathname.startsWith('/a'),
          handler: 'NetworkFirst',
          options: {
            cacheName: 'sank-shell',
            networkTimeoutSeconds: 3,
            plugins: [{
              // `ignoreSearch`, because a precached entry is stored under its
              // URL plus a `__WB_REVISION__` query the app never asks for.
              handlerDidError: async () => caches.match('/k', { ignoreSearch: true }),
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
        { name: 'theme-color', content: '#0e0e12' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: 'Šank' },
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        // IBM Plex Sans for everything. `main.css` names real system fallbacks,
        // so a phone that cannot reach Google Fonts renders the same layout in
        // the same sizes rather than a broken one.
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap',
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
     * One page is built to a static file at build time: `/k`, the waiter shell.
     *
     * It costs nothing — everything on that screen is inside `<ClientOnly>` and
     * depends on a session cookie the build has no way to see, so the rendered
     * HTML is the same "Učitavanje…" the server would send anyway. What it buys
     * is the service worker's `navigateFallback`: a worker can only answer an
     * offline navigation with a page it already holds, and a server-rendered
     * route is not a page it holds.
     */
    prerender: { routes: ['/k'] },

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
