/**
 * The guard on every `/admin` page except the login screen.
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
 * - **nobody is logged in** → `/`, the PIN pad. It used to be `/admin/login`,
 *   the e-mail door, and that is the wrong screen for the device the owner is
 *   almost always holding: he carries a phone, his PIN is what opens it, and
 *   the pad is the one screen that can also tell him *why* he is looking at a
 *   login — a session that ran out says so, and a phone the server does not
 *   know is sent to the enrol code instead of being asked for digits that
 *   cannot work. `/admin/login` is still there for the laptop, one quiet row
 *   down on that pad.
 * - **a waiter is logged in** → `/konobar`, his own screen. He is not an
 *   intruder, he is in the wrong room; sending him to a login form he has
 *   already passed would just look broken.
 */
export default defineNuxtRouteMiddleware(async () => {
  // On the server there is no answer to give. `useMe().load()` calls
  // `GET /api/me`, and a server-render `$fetch` carries no cookie jar, so the
  // server would always be told "nobody is logged in" and would bounce the
  // owner to the login screen on every hard reload. The guard is the browser's.
  if (import.meta.server) return

  const me = useMe()
  const state = me.me.value ? me.status.value : await me.load()

  if (state !== 'ready') return navigateTo('/')
  if (me.user.value?.role !== 'admin') return navigateTo(me.home.value)
})
