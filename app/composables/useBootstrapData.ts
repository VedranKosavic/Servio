/**
 * The menu, the floor plan and the staff list — one request, shared by every
 * waiter screen.
 *
 * `useAsyncData` caches by key, so the three screens that call this ask for the
 * same `'bootstrap'` entry rather than three separate downloads.
 *
 * `server: false` means: do not fetch this while rendering on the server. Every
 * screen behind it depends on the session in localStorage, which the server
 * cannot see, so server-rendering the catalog would only buy us a hydration
 * mismatch. The pages show a short "Učitavanje…" instead.
 *
 * `pending` is returned so a screen can tell "still loading" from "asked, and
 * the answer never came" — the first is *Učitavanje…* and the second has to say
 * so and offer *Pokušaj ponovo* (PHASE3 §4, *Honesty*). Nothing retries this on
 * a timer, because the service worker takes control only on the **second** load
 * and the very first bootstrap therefore goes past it uncached.
 */
export function useBootstrapData() {
  const api = useApi()
  return useAsyncData('bootstrap', () => api.getBootstrap(), { server: false })
}
