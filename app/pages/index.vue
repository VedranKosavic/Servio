<script setup lang="ts">
/**
 * The login screen — a PIN pad, and nothing else.
 *
 * **The PIN identifies the person** (CLAUDE.md, BACKEND §5). There is no list
 * of names in front of it, no faces, no *Ostali profili* and no role buttons:
 * the digits are the whole login, so a stranger holding an enrolled phone
 * learns nothing from the screen he is holding. `POST /api/auth/pin` takes
 * `{ pin }`, compares it against every active account of this device's venue,
 * and answers 401 naming nobody.
 *
 * The three states this screen can be in, and nothing else:
 *
 *   `boot`   asking the server who this is
 *   `pin`    the pad — the ordinary state, and the one this file is about
 *   `enrol`  this phone is not enrolled yet: a six-character code from the
 *            owner. Kept quiet and secondary — a foot row, and the place a
 *            `NO_DEVICE` from the pad lands. On a laptop with `SANK_DEV_ENROL=1`
 *            it enrols itself instead.
 *
 * **Where a correct PIN goes** is `homeFor()` in `useMe`, which is
 * `shared/landing.ts` with a route for its `null`: an admin lands on `/admin`,
 * a worker who has already chosen a screen tonight lands on it, and a worker who
 * has not lands on `/ekran` — *Na čemu si večeras?* — which is a second step
 * behind the PIN and never in front of one.
 *
 * **The composition.** One centred column, 420 px wide at most, holding the
 * wordmark, one panel and one quiet foot line — the same composition on a 390 px
 * phone (where the panel is the width of the screen) and on a 1440 px laptop
 * (where it is a card floating on the copper wash). Nothing stretches, and every
 * target on it clears 48 px.
 *
 * **Re-lock, and why the pad can work offline.** A shared bar tablet going idle
 * is a *screen over a session that is still alive* — the `sank_s` cookie was
 * never cleared — so the PIN can be checked against a PBKDF2 hash this phone
 * cached the last time the *server* accepted it (`useLock`), and only for the
 * person the live session already belongs to. Nothing here can *create* a
 * session, so a colleague, or a session that has really expired, gets
 * *"Nema veze — prijava traži internet"* instead of a pretence.
 *
 * The lockout copy comes out of the error body and nowhere else: five wrong PINs
 * are 60 s, ten are 15 minutes, and the pad counts the seconds down on screen in
 * tabular figures — a waiter staring at "pogrešan PIN" with no idea whether to
 * keep trying is how a phone ends up face-down on the bar.
 */
import { ApiSideError } from '~/composables/useApi'

useHead({ title: 'Prijava' })

const api = useApi()
const me = useMe()
const lock = useLock()
const update = useAppUpdate()

type View = 'boot' | 'pin' | 'enrol'
const view = ref<View>('boot')

/**
 * Why the enrol screen is on — and it is the whole point of this ref.
 *
 * `null` is the foot-row tap: somebody chose *Ovaj telefon nije prijavljen?*
 * and knows why he is here. The other two are the screen arriving uninvited,
 * and then it owes the person a sentence:
 *
 *   `unknown` this phone presented a `sank_d` the server has no row for — a
 *             database rebuilt under a browser that kept its cookie, or a
 *             device deleted in *Postavke → Uređaji*. **Not a PIN problem**,
 *             and the pad used to let it look like one.
 *   `revoked` the owner threw this phone out, or fifteen failures locked it.
 */
type DeviceReason = 'unknown' | 'revoked' | null
const deviceReason = ref<DeviceReason>(null)

const busy = ref(false)
const message = ref<string | null>(null)

/**
 * The session this phone was holding is over — it ran out, or somebody revoked
 * it — rather than there never having been one.
 *
 * It is a separate flag and not a message, because the pad still works: the
 * only thing that changes is the line under *Unesi PIN*, which says what
 * happened instead of leaving a waiter to guess that his own PIN stopped
 * working.
 */
const sessionExpired = ref(false)

/**
 * How many digits this pad waits for, and it is the venue's number rather than
 * a guess.
 *
 * The pad has nobody in front of it, so it cannot read a length off an account —
 * but it does not have to, because every active PIN in a venue is the same
 * length (`requirePinFree`, 409 `PIN_LEN_MIXED`) and `GET /api/auth/pin-len`
 * says which. That is the whole of what this screen may know before a session:
 * a number of digits, naming nobody.
 *
 * It used to start at 4 and jump to 6 the first time a PIN was refused —
 * "somebody's PIN must be six, then" — which was wrong twice over. It fired on
 * the fourth digit of a six-digit PIN, so if those four were a colleague's whole
 * PIN it signed **the colleague** in; and after any one mistype it stopped
 * firing on four for the rest of the visit, so every login until a reload became
 * five taps and a correct four-digit PIN did nothing visible at all.
 *
 * 4 is the fallback when the read fails — the café's real length, and the pad
 * still works offline on a re-lock, where there is no server to ask.
 */
const pinLen = ref<4 | 6>(4)

async function loadPinLen() {
  try {
    pinLen.value = (await api.getPinLen()).pin_len
  } catch {
    // No device yet, or no network. Neither is worth a sentence on this screen:
    // 4 is the café's length, and a wrong guess costs a refusal and not an
    // identity — the length is uniform, so no prefix of anybody's PIN is
    // anybody else's.
  }
}

const enrolCode = ref('')
const enrolLabel = ref('')

/** Tried once per visit to the enrol view: it 404s anywhere but a dev machine. */
const devEnrolTried = ref(false)

// -- lockout countdown ------------------------------------------------------

/**
 * Seconds left on a 423. It ticks down on screen because a locked pad with no
 * clock on it is indistinguishable from a broken one.
 */
const lockedFor = ref(0)
let lockTimer: ReturnType<typeof setInterval> | null = null

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
 * behind it, so it may unlock without the network.
 */
const relocked = computed(() => lock.relocked.value)

onMounted(async () => {
  // A newer build, the moment one is installed and waiting: take it.
  //
  // This screen is the app's one reliably safe moment — nobody is mid-round on
  // a lock screen, and the drafts and the outbox are in IndexedDB rather than
  // in memory, so the reload costs nothing. It is also the screen most likely
  // to be looking at an old bundle, because *Nova verzija* is only ever offered
  // on the two waiter lists: a tablet that sits here between shifts would never
  // have been asked. It watches instead of checking once, because the worker
  // that this very load woke up needs a second to install before it can say so.
  update.applyWhenIdle()

  const state = await me.load()

  // Somebody is signed in and this is not a re-lock: he typed the address, or
  // came back to a tab. There is nothing for him to do on a pad — his screen is
  // one `homeFor()` away, and the old *Nastavi kao …* card was a tap asking
  // whether he meant it.
  if (state === 'ready' && !relocked.value) {
    await navigateTo(me.home.value)
    return
  }
  if (state === 'nodevice') {
    // Two phones end up here and they are not the same phone. `/api/me` reports
    // an unknown `sank_d` as `NO_DEVICE` and a device the owner threw out as
    // `DEVICE_REVOKED`, and each gets its own sentence on the enrol screen.
    await enrolPath(me.authCode.value === 'DEVICE_REVOKED' ? 'revoked' : 'unknown')
    return
  }
  // `SESSION_REVOKED` is a session that was really there and is now over — the
  // fourteen hours ran out, or an admin ended it. `NO_SESSION` is the ordinary
  // start of a shift and says nothing. The pad is the same pad either way; only
  // the line under it changes.
  sessionExpired.value = me.authCode.value === 'SESSION_REVOKED'
  if (state === 'offline') {
    // A re-lock has a cached PIN to work with; anything else needs the network,
    // and the pad says so rather than swallowing the taps.
    message.value = relocked.value ? null : 'Nema veze sa serverom.'
  }
  view.value = 'pin'
  await loadPinLen()
})

// -- enrol ------------------------------------------------------------------

/**
 * The device door, and it is deliberately the quiet one.
 *
 * On a development machine `POST /api/dev/enrol` turns this browser into an
 * enrolled device with no code at all. It 404s everywhere `SANK_DEV_ENROL=1` is
 * not set — which is everywhere but a development machine (BACKEND §5.6) — and
 * that 404 is exactly how this screen knows to ask for a real code instead.
 */
async function enrolPath(reason: DeviceReason = null) {
  deviceReason.value = reason
  view.value = 'enrol'
  if (devEnrolTried.value) return
  devEnrolTried.value = true
  busy.value = true
  try {
    await api.devEnrol()
    message.value = null
    deviceReason.value = null
    view.value = 'pin'
    await loadPinLen()
  } catch {
    // No dev door: the six characters the owner reads out across the bar.
  } finally {
    busy.value = false
  }
}

/**
 * The lead line on the enrol screen, and the sentence this whole change is
 * about: an unknown phone is told it is an unknown phone.
 *
 * It is deliberately not `apiErrorText(NO_DEVICE)` verbatim — that sentence
 * names the fix ("Unesi kod za prijavu uređaja") and the heading right under
 * this line already is the fix. What the person needs first is the part the pad
 * never said: **the digits were never the problem**.
 */
const deviceNote = computed(() => {
  if (deviceReason.value === 'unknown') {
    return 'Ovaj telefon nije prijavljen. Nije do PIN-a — telefon se prvo prijavljuje kodom.'
  }
  if (deviceReason.value === 'revoked') {
    return 'Ovaj telefon je odjavljen ili zaključan. Javi se vlasniku za novi kod.'
  }
  return null
})

const codeReady = computed(() => enrolCode.value.trim().length === 6)

async function submitCode() {
  if (!codeReady.value || busy.value) return
  busy.value = true
  message.value = null
  try {
    await api.enrolDevice({
      code: enrolCode.value.trim().toUpperCase(),
      label: enrolLabel.value.trim() || undefined,
    })
    enrolCode.value = ''
    deviceReason.value = null
    sessionExpired.value = false
    view.value = 'pin'
    // This browser only became a device a moment ago, so the boot read of the
    // pad's length either never ran or 401'd. Ask now, before the first tap.
    await loadPinLen()
  } catch (err) {
    message.value = apiErrorText(err)
  } finally {
    busy.value = false
  }
}

function backToPad() {
  message.value = null
  deviceReason.value = null
  view.value = 'pin'
}

// -- the pad ----------------------------------------------------------------

/**
 * The line under *Unesi PIN*, and it is the one place the pad explains itself.
 *
 * Three states, in the order they beat each other: a session that is over says
 * so first (it is the surprising one, and the one that used to arrive as
 * silence); a tablet that re-locked itself says that; and otherwise the pad is
 * simply the pad.
 */
const padSub = computed(() => {
  if (sessionExpired.value) return 'Prijava je istekla. Unesi PIN ponovo.'
  if (relocked.value) return 'Telefon se zaključao sam. Unesi PIN da nastaviš.'
  return 'PIN te prijavljuje.'
})

/**
 * The one path a PIN can take without a network.
 *
 * Only over a live session — a re-lock — and only against a hash this phone
 * cached after the *server* accepted the same PIN, for the person that session
 * belongs to. Anything else answers `null` here and falls through to the server.
 */
async function tryOfflineUnlock(pin: string): Promise<boolean | null> {
  if (!relocked.value) return null
  const userId = me.user.value?.id
  if (!userId) return null
  return lock.verifyOffline(userId, pin)
}

/**
 * One tap of the last digit.
 *
 * `attempt()` answers *true* when the digits were fine and the **device** was
 * the problem — on a development machine `enrolPath()` fixes that silently, and
 * the same four digits are then worth sending again rather than being typed
 * twice for a door nobody saw.
 */
async function submitPin(pin: string) {
  if (await attempt(pin)) await attempt(pin)
}

async function attempt(pin: string): Promise<boolean> {
  if (busy.value || lockedFor.value > 0) return false

  busy.value = true
  message.value = null
  try {
    const offline = await tryOfflineUnlock(pin)
    if (offline === true) {
      lock.unlock()
      await afterLogin()
      return false
    }
    if (offline === false) {
      // A wrong PIN against the cache. No `auth_attempts` row was written, so
      // this is not metered — which is why the cache expires in 14 h and holds
      // a 150 000-round hash rather than the PIN.
      //
      // The second sentence is not decoration: with no network the only PIN
      // this phone can recognise is the one the *server* accepted here last,
      // so a colleague typing his own correct digits lands on exactly this
      // message and would otherwise read it as "my PIN is gone".
      message.value = 'PIN nije prepoznat. Bez veze radi samo PIN posljednje prijave.'
      return false
    }

    const result = await api.loginWithPin({ pin })
    // One parser: the login answers `{ user, session, device }` and `/api/me`
    // answers the venue and its settings with it, which every screen needs.
    await me.refreshAfterLogin()
    // The server said yes; only now is this PIN worth remembering for an
    // offline unlock of the same phone.
    await lock.remember(result.user.id, pin)
    lock.unlock()
    sessionExpired.value = false
    await afterLogin()
  } catch (err) {
    const e = err as ApiSideError
    if (e.code === 'LOCKED') {
      // The pad draws its own countdown from `lockedFor`, so the server's
      // sentence would be the same thing said twice.
      startLock(Number(e.data.retry_after_s ?? 60))
    } else if (e.code === 'NO_DEVICE' || e.code === 'DEVICE_REVOKED') {
      // Never enrolled, thrown out since, or holding a `sank_d` this server has
      // no row for. All three end at the same door — and none of them is a
      // wrong PIN, which is the whole reason they are caught here rather than
      // falling through to the sentence below.
      me.wipeLocalState()
      await lock.wipe()
      message.value = null
      await enrolPath(e.code === 'DEVICE_REVOKED' ? 'revoked' : 'unknown')
      // `enrolPath()` leaves the view on the pad only when the dev door enrolled
      // this browser, which is the one case where retrying makes sense.
      if (view.value === 'pin') {
        message.value = null
        return true
      }
    } else if (e.code === 'SESSION_REVOKED' || e.code === 'NO_SESSION') {
      // The pad itself never asks for a session, so this is a phone whose
      // session died between the boot read and the last digit. It is not a PIN
      // that stopped working, and the line under the heading says which.
      sessionExpired.value = e.code === 'SESSION_REVOKED'
      message.value = apiErrorText(err)
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
  return false
}

/**
 * The landing rule, and there is only one of it: `shared/landing.ts`, through
 * `homeFor()`. `/admin/login` calls `navigateTo('/admin')` after the same
 * `refreshAfterLogin()`, so an owner who signs in with a PIN on a phone and an
 * owner who signs in with a password on a laptop land on the same screen.
 */
async function afterLogin() {
  await navigateTo(me.home.value)
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
          product. Before the first sign-in this browser has no session and no
          venue to name, so the line says what the app is instead of leaving a
          hole where the hierarchy should be.
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

        <!-- This phone is not enrolled -->
        <section v-else-if="view === 'enrol'" class="stage">
          <!--
            Why this screen came up, when it came up by itself. It sits *above*
            the heading because the heading is already the instruction, and what
            the person is missing is the diagnosis: the pad refused him for the
            phone, not for the digits.
          -->
          <p
            v-if="deviceNote" class="note"
            :class="{ 'note-warn': deviceReason === 'revoked' }"
          >{{ deviceNote }}</p>

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

          <button type="button" class="more quiet" :disabled="busy" @click="backToPad">
            <span>Nazad na PIN</span>
          </button>
        </section>

        <!-- The pad, and this is the screen -->
        <section v-else class="stage">
          <div class="stage-head">
            <h2 class="section-title">Unesi PIN</h2>
            <p class="stage-sub">{{ padSub }}</p>
          </div>

          <WaiterPinPad
            :pin-len="pinLen"
            size="screen"
            corner="clear"
            :busy="busy"
            :error="message"
            :locked-for="lockedFor"
            @submit="submitPin"
          />

          <!-- The device door. Quiet, and at the foot: it is the once-a-year
               case, and the pad is the screen. -->
          <button type="button" class="more quiet" :disabled="busy" @click="enrolPath()">
            <span>Ovaj telefon nije prijavljen?</span>
            <svg
              class="more-chev" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
              fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
              stroke-linejoin="round"
            ><path d="M9 6l6 6-6 6" /></svg>
          </button>

          <!--
            The laptop's door, and the reason this row exists at all.
            `/admin` and *Odjavi se* both end on this pad now, which is right for
            the phone in the owner's apron and a dead end on a laptop: a laptop
            is not an enrolled device, so it has no PIN to type here. One quiet
            row is the way out. It names no person and no role — the pad still
            offers nobody — only the fact that a second door exists, which is
            already true of `/admin/login` itself.
          -->
          <NuxtLink to="/admin/login" class="more quiet">
            <span>Prijava e-mailom</span>
            <svg
              class="more-chev" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
              fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
              stroke-linejoin="round"
            ><path d="M9 6l6 6-6 6" /></svg>
          </NuxtLink>
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

/* ---- the foot rows ----------------------------------------------------- */

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
  /* One of these rows is a `NuxtLink` — the e-mail door — and an underline
     would be the only one on the screen. The rows are a list, not prose. */
  text-decoration: none;
  cursor: pointer;
}

.more > span:first-child { flex-grow: 1; text-align: left; }
.more-chev { flex-shrink: 0; color: var(--muted); }

.quiet { color: var(--muted); }
.quiet:disabled { opacity: 0.5; cursor: default; }

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

/* On a laptop the same composition simply breathes: more air above the
   wordmark and inside the panel, nothing stretched. */
@media (min-width: 640px) {
  .lock { padding: 40px 0 48px; }
  .lock-inner { gap: 28px; }
  .stage { padding: 28px 24px; gap: 18px; }
}
</style>
