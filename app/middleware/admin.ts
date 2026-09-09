/**
 * The guard on every `/a` page except the login screen.
 *
 * A page opts in with `definePageMeta({ middleware: 'admin', layout: 'admin' })`
 * — Nuxt route middleware, which runs before the page renders.
 *
 * **Client-side in practice, and that is not an oversight.** The session is an
 * httpOnly cookie the *server* reads; on a server render this middleware would
 * have to make the same `/api/me` call without the browser's cookie jar and
 * would bounce everybody to the login screen. `useMe` documents the same
 * reasoning for `requireSession()` on the waiter side.
 *
 * The two outcomes are deliberately different:
 *
 * - **nobody is logged in** → `/a/login`, where he can log in.
 * - **a waiter is logged in** → `/k`, his own screen. He is not an intruder, he
 *   is in the wrong room; sending him to a login form he has already passed
 *   would just look broken.
 */
export default defineNuxtRouteMiddleware(async () => {
  // On the server there is no answer to give. `useMe().load()` calls
  // `GET /api/me`, and a server-render `$fetch` carries no cookie jar, so the
  // server would always be told "nobody is logged in" and would bounce the
  // owner to the login screen on every hard reload. The guard is the browser's.
  if (import.meta.server) return

  const me = useMe()
  const state = me.me.value ? me.status.value : await me.load()

  if (state !== 'ready') return navigateTo('/a/login')
  if (me.user.value?.role !== 'admin') return navigateTo(me.home.value)
})
