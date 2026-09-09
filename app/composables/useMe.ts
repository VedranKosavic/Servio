/**
 * Who is holding this phone — according to the server, not according to us.
 *
 * Korak 1 kept the person in localStorage and believed it. That store is gone:
 * the answer now comes from `GET /api/me`, which reads the httpOnly session
 * cookie the browser cannot touch (BACKEND §5.5). Nothing on the phone decides
 * who anybody is, which is the whole point of WP9 — a device that could name
 * its own user could name the owner.
 *
 * `useState` rather than a module-level `ref`: it is Nuxt's per-request store,
 * so a server render never leaks one visitor's session into the next one's page.
 * Every screen calls the same key and shares one answer.
 *
 * The five states a phone can be in, and what each one means for the start
 * screen:
 *
 *   `unknown`  — nobody has asked yet (the very first paint)
 *   `ready`    — there is a session; `me` is the person
 *   `anon`     — the device is enrolled, nobody is logged in → the name list
 *   `nodevice` — no device cookie, or the owner revoked it → the enrol screen
 *   `offline`  — the server could not be reached; `me` is whatever we last knew
 */
import type { MeContext, Role } from '#shared/types'
import { ApiSideError } from '~/composables/useApi'

export type MeStatus = 'unknown' | 'ready' | 'anon' | 'nodevice' | 'offline'

/**
 * Where each role lives. Waiters get the floor plan, bartenders the ticket
 * queue, and since Phase 2 the admin gets the dashboard he logs in for.
 *
 * This is also the redirect a waiter who lands on `/a` follows: he is logged in,
 * just not welcome there, so he goes to `/k` rather than back to a login screen.
 */
export function homeFor(role: Role | undefined): string {
  if (role === 'admin') return '/a'
  return role === 'bartender' ? '/s' : '/k'
}

/** Everything this phone remembers on its own. Wiped when the device is revoked. */
function wipeLocalState() {
  if (!import.meta.client) return
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('sank:')) localStorage.removeItem(key)
    }
  } catch {
    // Private mode, or storage disabled. Nothing to wipe is not an error.
  }
}

export function useMe() {
  const api = useApi()
  const me = useState<MeContext | null>('sank:me', () => null)
  const status = useState<MeStatus>('sank:me:status', () => 'unknown')

  const user = computed(() => me.value?.user ?? null)
  const venue = computed(() => me.value?.venue ?? null)
  const device = computed(() => me.value?.device ?? null)
  const settings = computed(() => me.value?.venue.settings ?? null)
  const isReady = computed(() => status.value === 'ready' && !!me.value)
  const home = computed(() => homeFor(me.value?.user.role))

  /**
   * Ask the server who this is.
   *
   * Every failure mode is a *state*, not an exception: a screen calling this
   * must never have to catch anything. A network failure deliberately keeps the
   * person we last knew about, because losing the café's wifi for ten seconds is
   * not a reason to throw a waiter back to the lock screen mid-round.
   */
  async function load(): Promise<MeStatus> {
    try {
      me.value = await api.getMe()
      status.value = 'ready'
    } catch (err) {
      status.value = classify(err)
      if (status.value !== 'offline') me.value = null
      if (status.value === 'nodevice') wipeLocalState()
    }
    return status.value
  }

  function classify(err: unknown): MeStatus {
    const e = err as ApiSideError
    switch (e?.code) {
      // The owner threw this phone out, or it was never enrolled. Both end at
      // the same screen: a code from the admin.
      case 'DEVICE_REVOKED':
      case 'NO_DEVICE':
        return 'nodevice'
      case 'NO_SESSION':
      case 'SESSION_REVOKED':
      case 'DEVICE_MISMATCH':
        return 'anon'
      case 'NETWORK':
        return 'offline'
      default:
        // A 403 on `/api/me` cannot happen (it is `'any'` in ROUTE_ROLES), so
        // anything else here is a server that is not answering sensibly. Treat
        // it as "not logged in" rather than pretending somebody is.
        return e?.status === 0 ? 'offline' : 'anon'
    }
  }

  /**
   * After `POST /api/auth/pin` or an enrol: re-read the envelope rather than
   * assembling one out of the login response.
   *
   * The login answers `{ user, session, device }` and `/api/me` answers those
   * *plus* the venue and its settings, which every screen needs (`payment_methods`
   * decides whether the *Naplati* sheet draws a card button). One parser, one
   * shape, and no second place where a `MeContext` gets built by hand.
   */
  async function refreshAfterLogin(): Promise<MeStatus> {
    return load()
  }

  /**
   * *Promijeni korisnika*. Revokes the session and clears `sank_s`; the device
   * stays enrolled, and the shift membership stays open on purpose (§5.1).
   */
  async function logout(): Promise<void> {
    try {
      await api.logout()
    } catch {
      // A logout that could not reach the server still has to end at the lock
      // screen — leaving the waiter looking at a colleague's floor plan because
      // the wifi blinked is the worse failure.
    }
    me.value = null
    status.value = 'anon'
    await navigateTo('/')
  }

  /**
   * The guard every screen behind the lock calls in `onMounted`.
   *
   * It runs in the browser and not as route middleware for one reason: the
   * session lives in a cookie the *server* reads, so a middleware would have to
   * make the same `/api/me` call anyway — and on the server render it would make
   * it without the browser's cookie jar and bounce everybody to the start.
   */
  async function requireSession(roles?: Role[]): Promise<boolean> {
    const state = me.value ? status.value : await load()
    if (state !== 'ready' || !me.value) {
      if (state !== 'offline') await navigateTo('/')
      return false
    }
    if (roles && !roles.includes(me.value.user.role)) {
      await navigateTo(home.value)
      return false
    }
    return true
  }

  /**
   * What a poll does when a request comes back 401.
   *
   * A revoked device or an expired session has to end the screen, not just fail
   * one refresh — otherwise the phone keeps drawing a floor plan nobody is
   * allowed to see. Returns true when it handled the error and navigated.
   */
  async function handleAuthError(err: unknown): Promise<boolean> {
    const state = classify(err)
    if (state === 'nodevice' || state === 'anon') {
      if (state === 'nodevice') wipeLocalState()
      me.value = null
      status.value = state
      await navigateTo('/')
      return true
    }
    return false
  }

  return {
    me,
    status,
    user,
    venue,
    device,
    settings,
    isReady,
    home,
    load,
    refreshAfterLogin,
    logout,
    requireSession,
    handleAuthError,
    wipeLocalState,
  }
}
