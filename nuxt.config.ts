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

  nitro: {
    // better-sqlite3 is a native module: it must stay a real Node require
    // instead of being bundled into the server build.
    externals: { external: ['better-sqlite3'] },
  },
})
