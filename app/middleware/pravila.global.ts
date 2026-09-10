/**
 * The ack gate: on the first login after a new version of *Pravila*, S12 stands
 * in front of S1 and there is no *Kasnije* (PHASE4 §3, WP4).
 *
 * **What "global middleware" is.** A function Vue Router runs before every
 * route change. `.global` in the filename is what makes it apply to every page
 * instead of only the ones that name it — so this is one place that can send a
 * waiter to the rules screen no matter which dark screen he was heading for.
 *
 * Four things it deliberately does not do:
 *
 * - **Nothing on the server.** The session lives in a cookie the browser holds;
 *   a server render would have to ask `/api/me` without it and bounce everyone.
 *   `import.meta.client` is the first line for that reason (`useMe()` has the
 *   same note).
 * - **Nothing on `/a`.** The gate belongs in front of the floor plan and the
 *   ticket queue; the owner's dashboard has its own screen for this.
 * - **Nothing offline.** A phone with no signal cannot read `/api/rules`, and a
 *   waiter who is already working must not be walled off by a check that cannot
 *   complete. `navigator.onLine` is the cheap version of that.
 * - **Nothing mid-shift.** That rule lives in `useRules().gateActive`, not
 *   here: this only asks the question.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (!import.meta.client) return

  const path = to.path
  const dark = path === '/k' || path.startsWith('/k/') || path === '/s' || path.startsWith('/s/')
  // The one screen the gate sends people to cannot itself be gated.
  if (!dark || path === '/k/pravila') return

  if (!navigator.onLine) return

  const me = useMe()
  // A cold start has not asked yet. `load()` fills the same shared state the
  // page's own `requireSession()` reads a moment later, so this costs no extra
  // request — it only moves the first one earlier.
  if (me.status.value === 'unknown') await me.load()
  if (me.status.value !== 'ready') return

  const rules = useRules()
  await rules.ensure()
  if (rules.gateActive.value) return navigateTo('/k/pravila')
})
