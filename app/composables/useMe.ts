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
 *   `anon`     — the device is enrolled, nobody is logged in → the PIN pad
 *   `nodevice` — no device cookie, or the owner revoked it → the enrol screen
 *   `offline`  — the server could not be reached; `me` is whatever we last knew
 */
import type { MeContext, Role, ScreenMode } from '#shared/types'
import { landingFor } from '#shared/landing'
import { ApiSideError } from '~/composables/useApi'

export type MeStatus = 'unknown' | 'ready' | 'anon' | 'nodevice' | 'offline'

/**
 * Where this session lives — `shared/landing.ts` with a route for the `null`.
 *
 * The admin gets the dashboard he logs in for; a worker goes to whichever
 * screen he picked tonight, and to the chooser when he has not picked one. It
 * is also the redirect a worker who lands on `/admin` follows: he is logged in,
 * just not welcome there, so he goes to his screen rather than back to a pad.
 *
 * `CHOOSER` is the one route this file names rather than `shared/landing.ts`:
 * the chooser is a page, and pages are the client's business.
 */
export const CHOOSER = '/ekran'

export function homeFor(role: Role | undefined, mode?: ScreenMode | null): string {
  if (!role) return CHOOSER
  return landingFor(role, mode ?? null) ?? CHOOSER
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

  /**
   * The error code behind the last refusal — `NO_DEVICE`, `DEVICE_REVOKED`,
   * `SESSION_REVOKED`, `NO_SESSION` — or `null` while somebody is signed in.
   *
   * A `MeStatus` alone cannot carry this and the start screen needs it: a phone
   * the server has never seen and a phone the owner threw out are both
   * `nodevice`, and they are two different sentences with two different ways
   * out. Same on the other side — `anon` is both "nobody has typed anything
   * yet" and "your shift session ran out an hour ago", and the pad that says
   * the wrong one of those is the pad that looks like it has forgotten a PIN.
   */
  const authCode = useState<string | null>('sank:me:code', () => null)

  const user = computed(() => me.value?.user ?? null)
  const venue = computed(() => me.value?.venue ?? null)
  const device = computed(() => me.value?.device ?? null)
  const session = computed(() => me.value?.session ?? null)

  /**
   * Which staff screen this session picked tonight — `konobar`, `sanker` or
   * `null` for "has not chosen". It replaces every `role === 'bartender'`
   * branch the app used to make: the screen is a session's choice now, not a
   * property of the person, and an admin never has one.
   */
  const mode = computed(() => me.value?.session.mode ?? null)
  const settings = computed(() => me.value?.venue.settings ?? null)
  const isReady = computed(() => status.value === 'ready' && !!me.value)
  const home = computed(() => homeFor(me.value?.user.role, me.value?.session.mode))

  /**
   * Somebody PIN'd into a colleague's personal phone (*Drugi konobar*). The
   * session is two hours instead of fourteen, and — PHASE3 §3, WP4 — the app
   * says whose phone it is for the whole of it, because a round locked on
   * Emir's phone under Amar's name is exactly the thing that has to be visible
   * while it is happening rather than in the morning.
   */
  const borrowed = computed(() => me.value?.session.borrowed === true)

  /** *"Amar · Emirov telefon"* on a borrowed session, just the name otherwise. */
  const identityLabel = computed(() => {
    const name = me.value?.user.name ?? ''
    if (!borrowed.value) return name
    const label = me.value?.device?.label
    return label ? `${name} · ${label}` : name
  })

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
      authCode.value = null
    } catch (err) {
      status.value = classify(err)
      authCode.value = (err as ApiSideError)?.code ?? null
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
    // The remembered PINs go with the session. *Odjavi se* means somebody else
    // is about to hold this phone.
    const lock = useLock()
    await lock.wipe()
    lock.unlock()
    me.value = null
    status.value = 'anon'
    // A deliberate sign-out is not an expired session. Clearing the code is
    // what keeps the pad from greeting the next person with *Prijava je
    // istekla* when the last one simply handed the phone over.
    authCode.value = null
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
    // A worker who has not said which screen he is on tonight has no business
    // on one. The chooser is a step behind the PIN and not an optional one, so
    // the guard every dark screen already calls is where it is enforced —
    // typing `/konobar` into the address bar is not a way past it. An admin has
    // no mode and never sees the question.
    if (me.value.user.role !== 'admin' && !me.value.session.mode) {
      await navigateTo(CHOOSER)
      return false
    }
    // A shared bar tablet re-locks after `shared_device_idle_s` of no touch
    // (S10). This is the one call site every dark screen already makes, so
    // arming here means no page has to remember to; it is a no-op on a
    // personal phone and on the second call.
    useLock().arm()
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
      authCode.value = (err as ApiSideError)?.code ?? null
      if (state === 'nodevice') {
        wipeLocalState()
        // A revoked device may be in somebody else's hands by now.
        await useLock().wipe()
      }
      me.value = null
      status.value = state
      await navigateTo('/')
      return true
    }
    return false
  }

  return {
    mode,
    me,
    status,
    authCode,
    user,
    venue,
    device,
    session,
    borrowed,
    identityLabel,
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
