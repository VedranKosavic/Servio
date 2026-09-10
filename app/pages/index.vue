<script setup lang="ts">
/**
 * The lock screen — the first thing anybody sees, and the proof of the design
 * system (docs/DESIGN.md).
 *
 * Nothing on this screen is trusted: the phone proves it is an enrolled device
 * (the `sank_d` cookie), a person proves he is himself (a PIN through the
 * metered verifier), and the server hands back a session cookie the browser
 * cannot read. Every screen after this one asks `GET /api/me` rather than
 * reading localStorage.
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
 * **The composition.** One centred column, 420 px wide at most, holding the
 * wordmark, one panel and one quiet foot line — so the screen is the same
 * composition on a 390 px phone (where the panel is the width of the screen)
 * and on a 1440 px laptop (where it is a card floating on the copper wash).
 * Nothing stretches, and there is no gap in the middle for the eye to fall
 * into. Every target on it clears 48 px.
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
 * are 60 s, ten are 15 minutes, and the pad counts the seconds down on screen —
 * a waiter staring at "pogrešan PIN" with no idea whether to keep trying is how
 * a phone ends up face-down on the bar.
 */
import type { LoginUser } from '#shared/types'
import { ApiSideError } from '~/composables/useApi'
import { lastFaces } from '~/composables/useLock'

useHead({ title: 'Prijava' })

const api = useApi()
const me = useMe()
const lock = useLock()

type View = 'boot' | 'enrol' | 'people' | 'pin' | 'signed'
const view = ref<View>('boot')

const people = ref<LoginUser[]>([])
const chosen = ref<LoginUser | null>(null)
const busy = ref(false)
const message = ref<string | null>(null)

/** Set by a 403 `NOT_YOUR_DEVICE`: this is a colleague's personal phone. */
const borrowing = ref(false)

/** *Ostali profili* — the faces are three, the list behind them is everybody. */
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

/** The list under *Ostali profili*, or the whole venue when there are no faces. */
const listed = computed(() => (faces.value.length === 0 ? people.value : rest.value))

/**
 * On a `personal` phone the rest of the list is not "everybody else", it is
 * *Drugi konobar* — the colleague whose battery died, who will be asked to
 * confirm that he is borrowing this phone (§5.1).
 */
const restLabel = computed(() => (
  me.device.value?.mode === 'personal'
    ? 'Drugi konobar'
    : `Ostali profili (${rest.value.length})`
))

/** The copper avatar is reserved for the person this device is signed in as. */
function isMe(person: LoginUser): boolean {
  return me.user.value?.id === person.id
}

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
      // The pad draws its own countdown from `lockedFor`, so the server's
      // sentence would be the same thing said twice.
      startLock(Number(e.data.retry_after_s ?? 60))
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

/**
 * The landing rule, and there is only one of it.
 *
 * The destination comes from the role and from nowhere else: `homeFor()` in
 * `useMe.ts` maps waiter → `/konobar`, šanker → `/sanker`, admin → `/admin`.
 * `/admin/login` calls `navigateTo('/admin')` after the same
 * `refreshAfterLogin()`, so an owner who signs in with a PIN on a phone and an
 * owner who signs in with a password on a laptop land on the same screen.
 */
async function afterLogin() {
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
  <main class="lock">
    <!-- The copper wash. Full-bleed, behind everything, out of the a11y tree. -->
    <div class="lock-glow" aria-hidden="true" />

    <div class="lock-inner">
      <!-- The brand block: mark, wordmark, venue. Three sizes, one axis. -->
      <header class="brand">
        <svg
          class="brand-mark" viewBox="0 0 32 32" width="40" height="40"
          aria-hidden="true" focusable="false"
        >
          <rect
            x="0.75" y="0.75" width="30.5" height="30.5" rx="9.5"
            fill="var(--accent-soft)" stroke="var(--accent-line)" stroke-width="1.5"
          />
          <path
            d="M21 11.6a5 5 0 0 0-4.9-2.9c-2.6 0-4.3 1.3-4.3 3.3 0 4.3 9.4 2.5 9.4 6.9 0 2.2-1.9 3.6-4.7 3.6A5.4 5.4 0 0 1 11 19"
            fill="none" stroke="var(--accent)" stroke-width="2.1" stroke-linecap="round"
          />
        </svg>

        <h1 class="wordmark brand-name">{{ APP_NAME }}</h1>

        <!--
          The venue's own name is the third line, in copper — it is the only
          thing on this screen that belongs to the café rather than to the
          product. It is only known once this browser has a session
          (`GET /api/auth/users` deliberately carries nothing but the names), so
          before the first sign-in the line says what the app is instead of
          leaving a hole where the hierarchy should be.
        -->
        <ClientOnly>
          <p class="eyebrow brand-line" :class="{ venue: me.venue.value }">
            {{ me.venue.value?.name ?? APP_DESCRIPTION }}
          </p>
          <template #fallback>
            <p class="eyebrow brand-line">{{ APP_DESCRIPTION }}</p>
          </template>
        </ClientOnly>
      </header>

      <ClientOnly>
        <!-- Asking the server who this is -->
        <section v-if="view === 'boot'" class="stage stage-quiet">
          <p class="stage-sub">Učitavanje…</p>
        </section>

        <!-- Already logged in: one tap back into the shift -->
        <section v-else-if="view === 'signed' && me.user.value" class="stage">
          <div class="signed-who">
            <span class="avatar avatar-lg avatar-accent">{{ me.user.value.initials }}</span>
            <div class="signed-lines">
              <p class="section-title signed-name">{{ me.user.value.name }}</p>
              <p class="eyebrow">{{ ROLE_LABEL[me.user.value.role] }}</p>
            </div>
          </div>

          <div class="stack">
            <button type="button" class="btn btn-primary btn-lg" @click="afterLogin">
              Nastavi kao {{ me.user.value.name }}
            </button>
            <button type="button" class="btn btn-ghost" :disabled="busy" @click="changeUser">
              Promijeni korisnika
            </button>
          </div>
        </section>

        <!-- This phone is not enrolled -->
        <section v-else-if="view === 'enrol'" class="stage">
          <div class="stage-head">
            <h2 class="section-title">Unesi kod uređaja</h2>
            <p class="stage-sub">Vlasnik ti daje šestoslovni kod. Unosi se jednom, po telefonu.</p>
          </div>

          <div class="stack">
            <div class="field">
              <label class="eyebrow" for="enrol-code">Kod</label>
              <input
                id="enrol-code"
                v-model="enrolCode"
                class="input input-num code"
                type="text"
                inputmode="text"
                autocapitalize="characters"
                autocomplete="off"
                spellcheck="false"
                maxlength="6"
                placeholder="A1B2C3"
              >
            </div>

            <div class="field">
              <label class="eyebrow" for="enrol-label">Naziv uređaja</label>
              <input
                id="enrol-label"
                v-model="enrolLabel"
                class="input"
                type="text"
                maxlength="40"
                placeholder="npr. Tablet na šanku"
              >
            </div>
          </div>

          <p v-if="message" class="note note-danger">{{ message }}</p>

          <button
            type="button"
            class="btn btn-primary btn-lg"
            :disabled="!codeReady || busy"
            @click="submitCode"
          >
            {{ busy ? 'Prijavljujem uređaj…' : 'Prijavi uređaj' }}
          </button>
        </section>

        <!-- The PIN pad -->
        <section v-else-if="view === 'pin' && chosen" class="stage">
          <WaiterPinPad
            :name="chosen.name"
            :initials="chosen.initials"
            :role="ROLE_LABEL[chosen.role]"
            :pin-len="chosen.pin_len"
            :busy="busy"
            :error="message"
            :locked-for="lockedFor"
            :note="borrowing ? 'Posuđuješ tuđi telefon — prijava traje 2 sata.' : null"
            @submit="submitPin"
            @cancel="backToPeople"
          />
        </section>

        <!-- Pick a name -->
        <section v-else class="stage">
          <div class="stage-head">
            <h2 class="section-title">Prijava</h2>
            <p class="stage-sub">Odaberi svoj profil</p>
          </div>

          <p v-if="relocked" class="note">
            Telefon se zaključao sam. Unesi PIN da nastaviš.
          </p>

          <p v-if="message" class="note note-danger">{{ message }}</p>

          <!-- The last three who signed in on this phone, as faces. -->
          <div v-if="faces.length" class="faces">
            <button
              v-for="person in faces"
              :key="person.id"
              type="button"
              class="face"
              @click="pick(person)"
            >
              <span class="avatar avatar-lg" :class="{ 'avatar-accent': isMe(person) }">
                {{ person.initials }}
              </span>
              <span class="face-name">{{ person.name }}</span>
              <span class="face-role">{{ ROLE_LABEL[person.role] }}</span>
            </button>
          </div>

          <!-- …and everybody else, one tap away. Not a grey slab: a row with a
               chevron, which is what the rest of the app uses for "there is
               more behind this". -->
          <!-- `faces.length` guards it too: on a phone nobody has signed in on
               yet there are no faces, `listed` falls back to the whole venue and
               the list below is already open, so this row would offer to reveal
               people who are on screen. -->
          <button
            v-if="faces.length && rest.length && !showAll"
            type="button"
            class="more"
            @click="showAll = true"
          >
            <span>{{ restLabel }}</span>
            <svg
              class="more-chev" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
              fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
              stroke-linejoin="round"
            ><path d="M9 6l6 6-6 6" /></svg>
          </button>

          <div v-if="showAll || faces.length === 0" class="stack">
            <button
              v-for="person in listed"
              :key="person.id"
              type="button"
              class="person"
              @click="pick(person)"
            >
              <span class="avatar" :class="{ 'avatar-accent': isMe(person) }">
                {{ person.initials }}
              </span>
              <span class="person-name">{{ person.name }}</span>
              <!-- The same quiet uppercase the face tiles use, not a chip: a
                   chip on a `--surface-2` row is a chip nobody can see, and the
                   role is a fact to be found rather than a status to be read. -->
              <span class="face-role">{{ ROLE_LABEL[person.role] }}</span>
            </button>
          </div>

          <p v-if="!busy && people.length === 0" class="empty">
            Nema nikoga s postavljenim PIN-om.
            <span>Vlasnik ih postavlja u kontrolnoj ploči.</span>
          </p>

          <!-- The panel's foot row. Same shape as *Ostali profili* above it, so
               the bottom of the panel is a rule and an action rather than a
               button floating in space. -->
          <button type="button" class="more quiet" :disabled="busy" @click="loadPeople">
            <span>Osvježi listu</span>
            <svg
              class="more-chev" viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"
              fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
              stroke-linejoin="round"
            ><path d="M20 11.5A8 8 0 1 0 18 17M20 6v5.5h-5.5" /></svg>
          </button>
        </section>

        <template #fallback>
          <section class="stage stage-quiet">
            <p class="stage-sub">Učitavanje…</p>
          </section>
        </template>
      </ClientOnly>

    </div>
  </main>
</template>

<style scoped>
/* ---- the composition --------------------------------------------------- */

.lock {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 24px 0 32px;
}

.lock-glow {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  /**
   * One light source, from above.
   *
   * Sized in **pixels, not percentages**: a percentage-sized gradient becomes a
   * 1400 px smudge across a laptop and a tight blob on a phone, which is the
   * difference between a lit room and a rendering artefact. Three stops so the
   * falloff has no visible edge, and the whole thing stays far below any
   * threshold that could affect legibility.
   */
  background: radial-gradient(
    760px 420px at 50% 0%,
    color-mix(in oklab, var(--accent) 15%, transparent) 0%,
    color-mix(in oklab, var(--accent) 6%, transparent) 38%,
    transparent 78%
  );
}

.lock-inner {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 24px;
}

/* ---- the brand block --------------------------------------------------- */

.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.brand-mark { display: block; }

.brand-name {
  margin: 0;
  color: var(--ink);
}

.brand-line {
  margin: 0;
  color: var(--muted);
}

/* The venue is the local identity, and it is the one line on this screen set in
   the accent — copper is otherwise reserved for the primary action. */
.brand-line.venue { color: var(--accent-text); }

/* ---- the panel --------------------------------------------------------- */

.stage {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px 20px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
  /* A 1 px highlight along the top edge and a shadow under the whole panel:
     the one place in the app that genuinely floats, so the one place a shadow
     is earned. */
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.045),
    var(--shadow-pop);
}

/* Boot and hydration: the panel keeps its shape so nothing jumps when the
   real content arrives. */
.stage-quiet {
  min-height: 180px;
  align-items: center;
  justify-content: center;
}

.stage-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stage-head h2 { margin: 0; }

.stage-sub {
  margin: 0;
  font-size: var(--text-label);
  color: var(--muted);
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.note { margin: 0; }

/* ---- faces ------------------------------------------------------------- */

.faces {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

/* One, two or three of them share the row evenly. */
.faces:has(> :only-child) { grid-template-columns: minmax(0, 1fr); }
.faces:has(> :nth-child(2):last-child) { grid-template-columns: repeat(2, minmax(0, 1fr)); }

.face {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 132px;
  padding: 14px 6px;
  border-radius: var(--radius-card);
  border: 1px solid var(--line-soft);
  background: var(--surface-2);
  color: var(--ink);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-standard),
    transform var(--dur-tap) var(--ease-standard);
}

.face:active { background: var(--surface-3); transform: scale(0.97); }

.face-name {
  max-width: 100%;
  font-size: var(--text-label);
  font-weight: 600;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The role is there to be found, not read: it never competes with the name. */
.face-role {
  flex-shrink: 0;
  font-size: var(--text-caption);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--muted);
}

/* ---- everybody else ---------------------------------------------------- */

.more {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 0 4px;
  border: 0;
  border-top: 1px solid var(--line-soft);
  background: transparent;
  color: var(--ink-2);
  font-size: var(--text-label);
  font-weight: 600;
  cursor: pointer;
}

/* Two foot rows in a row are one block, not two: the stage's 16 px gap is
   cancelled between them so the rules read as a small list. */
.more + .more { margin-top: -16px; }

.more > span:first-child { flex-grow: 1; text-align: left; }
.more-chev { flex-shrink: 0; color: var(--muted); }

.person {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 64px;
  padding: 8px 12px;
  border-radius: var(--radius-card);
  border: 1px solid var(--line-soft);
  background: var(--surface-2);
  color: var(--ink);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-standard),
    transform var(--dur-tap) var(--ease-standard);
}

.person:active { background: var(--surface-3); transform: scale(0.98); }

.person-name {
  flex-grow: 1;
  min-width: 0;
  text-align: left;
  font-size: var(--text-body);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- already signed in ------------------------------------------------- */

.signed-who {
  display: flex;
  align-items: center;
  gap: 14px;
}

.signed-lines { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.signed-name { margin: 0; }
.signed-lines p:last-child { margin: 0; }

/* ---- enrol ------------------------------------------------------------- */

.field { display: flex; flex-direction: column; gap: 6px; }
.field label { margin: 0; }

.code {
  text-transform: uppercase;
  letter-spacing: 0.28em;
  /* The tracking is applied to the right of every character, the last one
     included, so without this the value reads a third of a space off-centre. */
  text-indent: 0.28em;
}

.code::placeholder { letter-spacing: 0.28em; text-transform: uppercase; }

/* ---- the quiet foot ---------------------------------------------------- */

.quiet { color: var(--muted); }
.quiet:disabled { opacity: 0.5; cursor: default; }

.empty span { display: block; }

/* On a laptop the same composition simply breathes: more air above the
   wordmark and inside the panel, nothing stretched. */
@media (min-width: 640px) {
  .lock { padding: 40px 0 48px; }
  .lock-inner { gap: 28px; }
  .stage { padding: 28px 24px; gap: 18px; }
}
</style>
