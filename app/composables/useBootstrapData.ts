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
 */
export function useBootstrapData() {
  const api = useApi()
  return useAsyncData('bootstrap', () => api.getBootstrap(), { server: false })
}
