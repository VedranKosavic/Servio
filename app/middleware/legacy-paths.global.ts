/**
 * The second half of the `/k` → `/konobar` rename, for the one case a server
 * redirect cannot reach.
 *
 * `nuxt.config.ts` `routeRules` answers `/k`, `/s` and `/a` with a 307, which
 * covers every real request. But an installed PWA that is **offline** never
 * reaches the server: the service worker hands the cached shell to a failed
 * navigation, and the router on the phone then has to resolve `/k` itself. Its
 * home-screen shortcut may still point there — a manifest is only re-read when
 * the browser feels like it — so without this the waiter would get a 404 with
 * no signal to fix it. Vue Router runs this before every navigation, so the
 * rewrite happens in the phone.
 *
 * Whole first segments only: `/stanje` and `/api/...` do not start with a
 * segment named `s` or `a` and are left alone.
 */
const MOVED: Record<string, string> = { k: 'konobar', s: 'sanker', a: 'admin' }

export default defineNuxtRouteMiddleware((to) => {
  // '/k/sto/3' → ['', 'k', 'sto', '3']; the first segment is all we match on.
  const [, first, ...rest] = to.path.split('/')
  const moved = MOVED[first ?? '']
  if (!moved) return

  return navigateTo(
    { path: ['', moved, ...rest].join('/'), query: to.query, hash: to.hash },
    // `replace`, so the back button does not land on the old path and bounce.
    { replace: true },
  )
})
