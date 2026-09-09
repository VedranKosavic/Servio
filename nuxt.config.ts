import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: ['@pinia/nuxt', '@vueuse/nuxt'],

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
