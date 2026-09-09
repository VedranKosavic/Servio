<script setup lang="ts">
/**
 * The start screen — and, since WP9, a real lock screen; since WP4, also the
 * *re*-lock (S10 *Promijeni korisnika*).
 *
 * Korak 1 asked "ko si?" and believed the answer. Nothing on this screen is
 * trusted: the phone proves it is an enrolled device (the `sank_d` cookie), a
 * person proves he is himself (a PIN through the metered verifier), and the
 * server hands back a session cookie the browser cannot read. Every screen after
 * this one asks `GET /api/me` rather than reading localStorage.
 *
 * The views, in the order a phone meets them:
 *
 *   `boot`     asking the server who this is
 *   `enrol`    this phone is not enrolled — a six-character code from the owner
 *              (on a laptop with `SANK_DEV_ENROL=1` it enrols itself instead)
 *   `people`   the names on this device's venue: the last three who signed in
 *              **here** as faces, everybody else one tap away
 *   `pin`      the pad, which submits on the last digit
 *   `signed`   somebody is already logged in: one tap back into the shift
 *
 * **Two things WP4 adds, and the difference between them matters.**
 *
 * *Re-lock* is a shared bar tablet going idle. It is a **screen over a session
 * that is still alive** — the `sank_s` cookie was never cleared — which is what
 * makes an offline unlock possible: the PIN is checked against a PBKDF2 hash
 * this phone cached the last time the *server* accepted it (`useLock`), the
 * screen re-opens, and the very next request revalidates the session anyway. If
 * that session has in fact expired, the screen says *"Nema veze — prijava traži
 * internet"* instead of pretending. It never invents a session.
 *
 * *Drugi konobar* is somebody else's phone. A `personal` device answers 403
 * `NOT_YOUR_DEVICE`; saying out loud that you are borrowing it turns that into
 * a two-hour `borrowed` session, and the app carries *"Amar · Emirov telefon"*
 * for the whole of it.
 *
 * The lockout copy comes out of the error body and nowhere else: five wrong PINs
 * are 60 s, ten are 15 minutes, and the sentence says which — a waiter staring
 * at "pogrešan PIN" with no idea whether to keep trying is how a phone ends up
 * face-down on the bar.
 */
import type { LoginUser } from '#shared/types'
import { ApiSideError } from '~/composables/useApi'
import { lastFaces } from '~/composables/useLock'

useHead({ title: 'Prijava' })

const api = useApi()
const me = useMe()
const lock = useLock()

type View = 'boot' | 'enrol' | 'people' | 'pin' | 'signed' | 'admin-note'
const view = ref<View>('boot')

const people = ref<LoginUser[]>([])
const chosen = ref<LoginUser | null>(null)
const busy = ref(false)
const message = ref<string | null>(null)

/** Set by a 403 `NOT_YOUR_DEVICE`: this is a colleague's personal phone. */
const borrowing = ref(false)

/** *Svi ostali* — the faces are three, the list behind them is everybody. */
const showAll = ref(false)

const enrolCode = ref('')
const enrolLabel = ref('')

// -- lockout countdown ------------------------------------------------------

/**
 * Seconds left on a 423. It ticks down on screen because a locked pad with no
 * clock on it is indistinguishable from a broken one.
 */
const lockedFor = ref(0)
let lockTimer: ReturnType<typeof setInterval> | null = null

/**
 * The lockout is the server's, and it is counted against `(device, user)` — so
 * it belongs to the person on the pad, not to the pad. Picking somebody else has
 * to clear it, or Dino's five wrong guesses would lock Amar out of his own shift
 * for a minute on a phone he never touched.
 */
function clearLock() {
  lockedFor.value = 0
  if (lockTimer) clearInterval(lockTimer)
  lockTimer = null
}

function startLock(seconds: number) {
  lockedFor.value = Math.max(0, Math.round(seconds))
  if (lockTimer) clearInterval(lockTimer)
  lockTimer = setInterval(() => {
    lockedFor.value -= 1
    if (lockedFor.value <= 0) {
      lockedFor.value = 0
      message.value = null
      if (lockTimer) clearInterval(lockTimer)
      lockTimer = null
    }
  }, 1000)
}

onBeforeUnmount(() => {
  if (lockTimer) clearInterval(lockTimer)
})

const lockText = computed(() =>
  lockedFor.value > 0 ? `PIN je zaključan. Pokušaj ponovo za ${lockedFor.value} s.` : null)

// -- boot -------------------------------------------------------------------

/**
 * Did the tablet re-lock itself, rather than somebody logging out?
 *
 * The difference is entirely about *this* screen: a re-lock still has a session
 * behind it, so it may unlock without the network and it says so.
 */
const relocked = computed(() => lock.relocked.value)

onMounted(async () => {
  const state = await me.load()

  // A re-lock never shows *Nastavi kao …*: the point of it is that the person
  // holding the tablet may not be the person the session belongs to.
  if (state === 'ready' && !relocked.value) {
    view.value = 'signed'
    return
  }
  if (state === 'nodevice') {
    await enrolThisDevice()
    return
  }
  if (state === 'offline') {
    // Offline and re-locked is the case this whole screen was rewritten for:
    // the names are the ones this phone already knew, and the PIN is checked
    // against the cache. Offline and *not* re-locked has nothing to work with.
    message.value = relocked.value ? null : 'Nema veze sa serverom.'
    view.value = 'people'
    return
  }
  await loadPeople()
})

/**
 * The names on this device's venue. `GET /api/auth/users` is the one response a
 * stranger holding an enrolled phone can read, so it carries no more than this
 * list draws — and people without a PIN are left out, because tapping them would
 * open a pad that can never be right.
 */
async function loadPeople() {
  busy.value = true
  try {
    people.value = (await api.getLoginUsers()).filter(u => u.active && u.has_pin)
    view.value = 'people'
    message.value = null
  } catch (err) {
    const e = err as ApiSideError
    if (e.code === 'NO_DEVICE' || e.code === 'DEVICE_REVOKED') {
      // This is where "is this phone enrolled?" is actually answered: `/api/me`
      // says `NO_SESSION` whether or not a device cookie exists (the session is
      // resolved first), so the device question only surfaces on the one route
      // that needs a device and no session.
      me.wipeLocalState()
      await lock.wipe()
      message.value = apiErrorText(err)
      await enrolThisDevice()
    } else {
      // A re-locked tablet with no network keeps whatever names it has: an
      // empty list would strand the person holding it.
      if (!relocked.value || people.value.length === 0) {
        message.value = apiErrorText(err, 'Nema veze sa serverom.')
      }
      view.value = 'people'
    }
  } finally {
    busy.value = false
  }
}

/**
 * On a laptop, `POST /api/dev/enrol` turns this browser into an enrolled device
 * with no code at all. It 404s everywhere `SANK_DEV_ENROL=1` is not set — which
 * is everywhere but a development machine (§5.6) — and that 404 is exactly how
 * this screen knows to ask for a real code instead.
 */
async function enrolThisDevice() {
  busy.value = true
  try {
    const result = await api.devEnrol()
    // The enrol response has no per-device recency yet, which is honest: this
    // phone has no history on it.
    people.value = result.users
      .filter(u => u.active && u.has_pin)
      .map(u => ({ ...u, last_login_at: null }))
    view.value = 'people'
    message.value = null
  } catch {
    view.value = 'enrol'
  } finally {
    busy.value = false
  }
}

// -- who is offered ---------------------------------------------------------

/** The three most recent sign-ins **on this device**, and everybody else. */
const split = computed(() => lastFaces(people.value))
const faces = computed(() => split.value.faces)
const rest = computed(() => split.value.rest)

/**
 * On a `personal` phone the rest of the list is not "everybody else", it is
 * *Drugi konobar* — the colleague whose battery died, who will be asked to
 * confirm that he is borrowing this phone (§5.1).
 */
const restLabel = computed(() => (
  me.device.value?.mode === 'personal'
    ? 'Drugi konobar'
    : `Svi ostali (${rest.value.length})`
))

// -- enrol ------------------------------------------------------------------

const codeReady = computed(() => enrolCode.value.trim().length === 6)

async function submitCode() {
  if (!codeReady.value || busy.value) return
  busy.value = true
  message.value = null
  try {
    const result = await api.enrolDevice({
      code: enrolCode.value.trim().toUpperCase(),
      label: enrolLabel.value.trim() || undefined,
    })
    people.value = result.users
      .filter(u => u.active && u.has_pin)
      .map(u => ({ ...u, last_login_at: null }))
    enrolCode.value = ''
    view.value = 'people'
  } catch (err) {
    message.value = apiErrorText(err)
  } finally {
    busy.value = false
  }
}

// -- pin --------------------------------------------------------------------

function pick(person: LoginUser) {
  chosen.value = person
  borrowing.value = false
  message.value = null
  clearLock()
  view.value = 'pin'
}

function backToPeople() {
  chosen.value = null
  borrowing.value = false
  message.value = null
  showAll.value = false
  clearLock()
  view.value = 'people'
}

/**
 * The one path a PIN can take without a network.
 *
 * Only for the person the live session already belongs to, and only against a
 * hash this phone cached after the *server* accepted the same PIN. Anything
 * else — a different colleague, nothing cached, no `crypto.subtle` — answers
 * `null` here and falls through to the server.
 */
async function tryOfflineUnlock(person: LoginUser, pin: string): Promise<boolean | null> {
  if (!relocked.value) return null
  if (me.user.value?.id !== person.id) return null
  return lock.verifyOffline(person.id, pin)
}

async function submitPin(pin: string) {
  const person = chosen.value
  if (!person || busy.value || lockedFor.value > 0) return

  busy.value = true
  message.value = null
  try {
    const offline = await tryOfflineUnlock(person, pin)
    if (offline === true) {
      lock.unlock()
      await afterLogin()
      return
    }
    if (offline === false) {
      // A wrong PIN against the cache. No `auth_attempts` row was written, so
      // this is not metered — which is why the cache expires in 14 h and holds
      // a 150 000-round hash rather than the PIN.
      message.value = 'Pogrešan PIN.'
      return
    }

    await api.loginWithPin({
      user_id: person.id,
      pin,
      ...(borrowing.value ? { borrow: true } : {}),
    })
    // One parser: the login answers `{ user, session, device }` and `/api/me`
    // answers the venue and its settings with it, which every screen needs.
    await me.refreshAfterLogin()
    // The server said yes; only now is this PIN worth remembering for an
    // offline unlock of the same phone.
    await lock.remember(person.id, pin)
    lock.unlock()
    await afterLogin()
  } catch (err) {
    const e = err as ApiSideError
    if (e.code === 'LOCKED') {
      startLock(Number(e.data.retry_after_s ?? 60))
      message.value = apiErrorText(err)
    } else if (e.code === 'NOT_YOUR_DEVICE') {
      // A colleague's personal phone. The 403 is not a refusal, it is a
      // question: say out loud that you are borrowing it and the session is 2 h
      // instead of 14 (§5.1).
      borrowing.value = true
      message.value = 'Ovo je tuđi telefon. Potvrdi da ga posuđuješ i unesi PIN ponovo.'
    } else if (e.code === 'NETWORK') {
      // The honest half of the offline story: this screen can re-open over a
      // session that is still alive, but nothing on this phone can *create* a
      // session — so a colleague signing in, or a session that has really
      // expired, waits for the network rather than being let through.
      message.value = 'Nema veze — prijava traži internet.'
    } else {
      message.value = apiErrorText(err)
    }
  } finally {
    busy.value = false
  }
}

/** Waiter → stolovi, šanker → tiketi, admin → a word about Phase 2 first. */
async function afterLogin() {
  if (me.user.value?.role === 'admin') {
    view.value = 'admin-note'
    return
  }
  await navigateTo(me.home.value)
}

async function changeUser() {
  busy.value = true
  try {
    await api.logout()
  } catch {
    // Same as `useMe().logout()`: the lock screen is where this ends either way.
  }
  // *Promijeni korisnika* is a real sign-out, so the remembered PINs go too.
  await lock.wipe()
  lock.unlock()
  me.me.value = null
  me.status.value = 'anon'
  busy.value = false
  chosen.value = null
  await loadPeople()
}

const ROLE_LABEL: Record<string, string> = {
  waiter: 'konobar',
  bartender: 'šanker',
  admin: 'vlasnik',
}
</script>

<template>
  <main class="mx-auto flex w-full max-w-[480px] flex-1 flex-col justify-center gap-7 py-8">
    <div class="text-center">
      <h1 class="text-5xl font-extrabold tracking-tight">
        Šank
      </h1>
      <p v-if="me.venue.value" class="mt-1 text-[15px] text-text-2">
        {{ me.venue.value.name }}
      </p>
    </div>

    <ClientOnly>
      <!-- Asking the server who this is -->
      <p v-if="view === 'boot'" class="text-center text-text-2">
        Učitavanje…
      </p>

      <!-- Already logged in: one tap back into the shift -->
      <div v-else-if="view === 'signed' && me.user.value" class="flex flex-col gap-3">
        <button type="button" class="btn btn-accent h-16 text-xl" @click="afterLogin">
          Nastavi kao {{ me.user.value.name }} ({{ ROLE_LABEL[me.user.value.role] }})
        </button>
        <button type="button" class="btn btn-ghost" :disabled="busy" @click="changeUser">
          Promijeni korisnika
        </button>
      </div>

      <!-- The owner dashboard is not built yet -->
      <div v-else-if="view === 'admin-note'" class="flex flex-col gap-4">
        <div class="card flex flex-col gap-2 p-4 text-center">
          <p class="text-lg font-semibold">
            Kontrolna tabla još nije spremna
          </p>
          <p class="text-[15px] text-text-2">
            Vlasnički pregled (/a) stiže u drugoj fazi. Do tada koristiš isti
            ekran kao konobari — stolovi, narudžbe i naplata rade normalno.
          </p>
        </div>
        <button type="button" class="btn btn-accent h-14 text-lg" @click="navigateTo('/k')">
          Nastavi na stolove
        </button>
        <button type="button" class="btn btn-ghost" :disabled="busy" @click="changeUser">
          Promijeni korisnika
        </button>
      </div>

      <!-- This phone is not enrolled -->
      <div v-else-if="view === 'enrol'" class="flex flex-col gap-4">
        <div class="text-center">
          <h2 class="text-2xl font-semibold">
            Unesi kod uređaja
          </h2>
          <p class="mt-1 text-[15px] text-text-2">
            Vlasnik ti daje šestoslovni kod. Unosi se jednom, po telefonu.
          </p>
        </div>

        <input
          v-model="enrolCode"
          type="text"
          inputmode="text"
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          maxlength="6"
          placeholder="A1B2C3"
          class="num card-2 h-16 w-full px-4 text-center text-3xl font-bold uppercase tracking-[0.3em] outline-none placeholder:text-muted placeholder:tracking-[0.3em]"
        >

        <input
          v-model="enrolLabel"
          type="text"
          maxlength="40"
          placeholder="Naziv uređaja (npr. Šank tablet)"
          class="card-2 h-12 w-full px-3.5 text-base outline-none placeholder:text-muted"
        >

        <p v-if="message" class="rounded-xl bg-danger-soft px-3 py-2 text-center text-[15px] text-danger">
          {{ message }}
        </p>

        <button
          type="button"
          class="btn btn-accent h-14 text-lg"
          :disabled="!codeReady || busy"
          @click="submitCode"
        >
          {{ busy ? 'Prijavljujem uređaj…' : 'Prijavi uređaj' }}
        </button>
      </div>

      <!-- The PIN pad -->
      <WaiterPinPad
        v-else-if="view === 'pin' && chosen"
        :name="chosen.name"
        :initials="chosen.initials"
        :pin-len="chosen.pin_len"
        :busy="busy"
        :error="lockText ?? message"
        :locked="lockedFor > 0"
        :note="borrowing ? 'Posuđuješ tuđi telefon — prijava traje 2 sata.' : null"
        @submit="submitPin"
        @cancel="backToPeople"
      />

      <!-- Pick a name -->
      <div v-else class="flex flex-col gap-3">
        <h2 class="text-center text-2xl font-semibold">
          Ko si?
        </h2>

        <p v-if="relocked" class="text-center text-[15px] text-text-2">
          Telefon se zaključao sam. Unesi PIN da nastaviš.
        </p>

        <p v-if="message" class="rounded-xl bg-danger-soft px-3 py-2 text-center text-[15px] text-danger">
          {{ message }}
        </p>

        <!-- The last three who signed in on this phone, as faces. -->
        <!-- One, two or three of them share the row evenly. -->
        <div v-if="faces.length" class="flex gap-2">
          <button
            v-for="person in faces"
            :key="person.id"
            type="button"
            class="card-2 flex min-h-28 basis-0 grow flex-col items-center justify-center gap-2 px-2 py-3"
            @click="pick(person)"
          >
            <span class="flex size-14 items-center justify-center rounded-full bg-accent text-lg font-bold text-accent-ink">
              {{ person.initials }}
            </span>
            <span class="truncate text-[17px] font-semibold">{{ person.name }}</span>
          </button>
        </div>

        <!-- …and everybody else, one tap away. -->
        <button
          v-if="rest.length && !showAll"
          type="button"
          class="btn btn-ghost h-14"
          @click="showAll = true"
        >
          {{ restLabel }}
        </button>

        <template v-if="showAll || faces.length === 0">
          <button
            v-for="person in (faces.length === 0 ? people : rest)"
            :key="person.id"
            type="button"
            class="btn h-16 justify-start gap-3 px-4 text-xl"
            @click="pick(person)"
          >
            <span class="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-base font-bold">
              {{ person.initials }}
            </span>
            <span class="grow text-left">{{ person.name }}</span>
            <span class="chip shrink-0">{{ ROLE_LABEL[person.role] }}</span>
          </button>
        </template>

        <p v-if="!busy && people.length === 0" class="card px-4 py-8 text-center text-text-2">
          Nema nikoga s postavljenim PIN-om. Vlasnik ih postavlja u kontrolnoj tabli.
        </p>

        <button type="button" class="btn btn-ghost" :disabled="busy" @click="loadPeople">
          Osvježi
        </button>
      </div>

      <template #fallback>
        <p class="text-center text-text-2">
          Učitavanje…
        </p>
      </template>
    </ClientOnly>
  </main>
</template>
