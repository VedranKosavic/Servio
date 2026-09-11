/**
 * The one name the service worker's page cache is known by.
 *
 * Two files need it and they are on opposite sides of the app: `nuxt.config.ts`
 * hands it to Workbox at build time, and `app/plugins/shell-cache.client.ts`
 * empties that cache in the browser whenever the build changes. A literal typed
 * twice is a cache that is written under one name and cleared under another,
 * which fails silently and looks like a phone stuck on an old version — so it
 * is written once, here, in the folder both sides already import from.
 */
export const SHELL_CACHE = 'sank-shell'
