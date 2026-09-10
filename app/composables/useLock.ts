/**
 * *Promijeni korisnika* (S10) — the re-lock, and the honest offline unlock.
 *
 * Two separate jobs live here, and keeping them separate is the whole design.
 *
 * **1. The idle re-lock.** A `shared` bar tablet gets handed across the counter
 * a dozen times a night. After `shared_device_idle_s` of nobody touching it, the
 * app goes back to the lock screen so the next person cannot lock a round under
 * the last person's name. A *personal* phone is never re-locked: it is one
 * person's pocket, and the iPhone's own lock screen already guards it.
 *
 * **2. The offline unlock — and what it is not.** The re-lock is a *client-side
 * screen over a session that is still alive*: the `sank_s` cookie was never
 * cleared, so the phone is still logged in as far as the server is concerned.
 * That is what makes an offline unlock possible at all, and it is also the
 * limit of it. This screen can re-open without the network; it cannot *create*
 * a session, so a session that has actually expired sends the person to the
 * real lock screen with *"Nema veze — prijava traži internet"* rather than
 * pretending it let him in.
 *
 * **PBKDF2, in two lines.** We must not keep the PIN. Instead we keep a *slow
 * hash* of it: `crypto.subtle.deriveBits` runs SHA-256 150 000 times over the
 * PIN plus a random per-(user, device) salt, which takes this phone a fraction
 * of a second and makes guessing all 10 000 four-digit PINs out of a stolen
 * IndexedDB take meaningfully longer than the 14 hours the entry lives. It is
 * *not* the server's PIN check — that one is scrypt with a pepper and a lockout
 * (BACKEND §5.2), and it is the one that still runs on the next request.
 *
 * The cache is wiped on *Odjavi se*, on `DEVICE_REVOKED`, and after 14 h.
 */
import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval'

/** One IndexedDB key holds every remembered PIN on this phone. */
const CACHE_KEY = 'sank:pin-cache'

/** How long a remembered PIN may re-open the screen. A shift plus a margin. */
const CACHE_MAX_AGE_MS = 14 * 60 * 60 * 1000

/** OWASP's floor for PBKDF2-SHA-256 at the time of writing, and PHASE3 §3's number. */
const PBKDF2_ITERATIONS = 150_000

/** How many faces the lock screen offers before *Svi ostali*. */
export const LAST_FACES = 3

interface CacheEntry {
  user_id: string
  device_id: string
  /** base64, 16 random bytes. Per user and per device, never reused. */
  salt: string
  /** base64 of the derived bits. */
  hash: string
  at: string
}

// ---------------------------------------------------------------------------
// PBKDF2
// ---------------------------------------------------------------------------

function toBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
}

/**
 * `Uint8Array<ArrayBuffer>`, not `Uint8Array<ArrayBufferLike>`: `deriveBits`
 * wants a buffer it knows is not shared between threads, and TypeScript's DOM
 * types distinguish the two. Building the array over an `ArrayBuffer` we made
 * ourselves says so without a cast.
 */
function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** 16 fresh random bytes, in a buffer of their own. */
function randomSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)))
}

/** Is `crypto.subtle` there at all? It needs a secure context — https or localhost. */
function hasSubtle(): boolean {
  return import.meta.client && typeof crypto !== 'undefined' && !!crypto.subtle
}

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key, 256,
  )
  return toBase64(bits)
}

/**
 * A comparison that takes the same time whether the first byte matches or the
 * last one does. Overkill against a local attacker who has the whole database
 * anyway — but a timing-leaky compare in an auth path is the kind of thing that
 * gets copied into one that matters.
 */
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function readCache(): Promise<CacheEntry[]> {
  try {
    const stored = await idbGet<CacheEntry[]>(CACHE_KEY)
    if (!Array.isArray(stored)) return []
    const cutoff = Date.now() - CACHE_MAX_AGE_MS
    return stored.filter(e => Date.parse(e.at) > cutoff)
  } catch {
    // Private mode, or storage refused. No cache is not an error — it means the
    // unlock needs the network, which the screen says out loud.
    return []
  }
}

async function writeCache(entries: CacheEntry[]): Promise<void> {
  try {
    await idbSet(CACHE_KEY, entries)
  } catch {
    // Same: a phone that cannot remember simply asks the server every time.
  }
}

export function useLock() {
  const me = useMe()

  /**
   * Is the screen currently the re-lock rather than the ordinary start screen?
   *
   * `useState` and not a module ref: it is read by `pages/index.vue` after a
   * `navigateTo`, and it must not survive into another visitor's server render.
   */
  const relocked = useState<boolean>('sank:relocked', () => false)

  /** Set once per app load, so the idle watcher is installed exactly once. */
  const armed = useState<boolean>('sank:relock-armed', () => false)

  // -- the idle timer -------------------------------------------------------

  /**
   * Start watching for idleness on a shared device.
   *
   * Called from `useMe().requireSession()`, which every `/konobar` and
   * `/sanker` screen runs in `onMounted` — so it covers exactly the dark
   * screens and never the owner's dashboard, and no other package has to
   * remember to call anything.
   */
  function arm(): void {
    if (!import.meta.client || armed.value) return
    const device = me.device.value
    if (!device || device.mode !== 'shared') return

    armed.value = true
    const idleMs = (me.settings.value?.shared_device_idle_s ?? 300) * 1000
    let timer: ReturnType<typeof setTimeout> | null = null

    const bump = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { void lock() }, idleMs)
    }

    for (const event of ['pointerdown', 'keydown', 'touchstart', 'visibilitychange']) {
      window.addEventListener(event, bump, { passive: true })
    }
    bump()
  }

  /**
   * Go back to the lock screen **without logging out**.
   *
   * The session cookie stays: this is a screen, not a sign-out, which is what
   * lets the same person come straight back in with no network. *Odjavi se* in
   * the avatar sheet is the other thing, and it revokes.
   */
  async function lock(): Promise<void> {
    if (!import.meta.client) return
    relocked.value = true
    if (useRoute().path !== '/') await navigateTo('/')
  }

  /** The person came back in (or a fresh login happened). Drop the overlay. */
  function unlock(): void {
    relocked.value = false
  }

  // -- the remembered PIN ---------------------------------------------------

  /**
   * Remember this PIN for this (user, device) pair, after the **server** has
   * accepted it. Never called on a guess the server has not seen.
   */
  async function remember(userId: string, pin: string): Promise<void> {
    const deviceId = me.device.value?.id
    if (!deviceId || !hasSubtle()) return
    const salt = randomSalt()
    const hash = await derive(pin, salt)
    const rest = (await readCache()).filter(e => !(e.user_id === userId && e.device_id === deviceId))
    await writeCache([...rest, {
      user_id: userId,
      device_id: deviceId,
      salt: toBase64(salt.buffer),
      hash,
      at: new Date().toISOString(),
    }])
  }

  /**
   * Does this PIN match the one the server accepted on this phone within 14 h?
   *
   * `null` means *we cannot say* — nothing cached, or no `crypto.subtle` — and
   * the screen must then ask the server rather than treat it as a refusal.
   */
  async function verifyOffline(userId: string, pin: string): Promise<boolean | null> {
    const deviceId = me.device.value?.id
    if (!deviceId || !hasSubtle()) return null
    const entry = (await readCache())
      .find(e => e.user_id === userId && e.device_id === deviceId)
    if (!entry) return null
    return sameHash(await derive(pin, fromBase64(entry.salt)), entry.hash)
  }

  /** Is there anything remembered for this person on this phone? */
  async function canUnlockOffline(userId: string): Promise<boolean> {
    const deviceId = me.device.value?.id
    if (!deviceId) return false
    return (await readCache()).some(e => e.user_id === userId && e.device_id === deviceId)
  }

  /** *Odjavi se*, a revoked device, or a PIN reset: forget everything. */
  async function wipe(): Promise<void> {
    try {
      await idbDel(CACHE_KEY)
    } catch {
      // Nothing to forget is not an error.
    }
  }

  return {
    relocked, arm, lock, unlock,
    remember, verifyOffline, canUnlockOffline, wipe,
  }
}

/**
 * The three faces the lock screen offers first (PHASE3 §1.8).
 *
 * Sorted by when each person last signed in **on this device**; anybody who
 * never has drops to the *Svi ostali* list. Exported as a plain function so the
 * ordering is testable without a browser.
 */
export function lastFaces<T extends { last_login_at: string | null }>(
  users: T[], howMany = LAST_FACES,
): { faces: T[], rest: T[] } {
  const seen = users
    .filter(u => u.last_login_at)
    .sort((a, b) => (b.last_login_at! < a.last_login_at! ? -1 : 1))
  const faces = seen.slice(0, howMany)
  const rest = users.filter(u => !faces.includes(u))
  return { faces, rest }
}
