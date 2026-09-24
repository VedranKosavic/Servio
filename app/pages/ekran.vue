<script setup lang="ts">
/**
 * *Na čemu si večeras?* and *Koju smjenu radiš?* — the two steps behind the PIN.
 *
 * Which staff screen a worker is on tonight stopped being a property of his
 * account: it is a `ScreenMode` on his **session** (`shared/landing.ts`), so
 * both screens stay open to everybody and nobody signs out to move between
 * them. This page is where the choice is first made; the same route behind it,
 * `POST /api/auth/mode`, is also what *Prebaci na šank* calls from the profile
 * sheet at midnight.
 *
 * **It survives a reload without a PIN**, which is the whole reason it is a
 * route and not a piece of `pages/index.vue` state: the session already exists
 * by the time anybody sees this: the mode is the only thing still missing, and
 * refreshing at 02:00 asks the server for it rather than asking the person for
 * his digits again.
 *
 * **An admin never sees it.** His landing is `/admin` whatever his session says,
 * so he is redirected out of here the moment `/api/me` answers — he may still
 * open the staff screens (he serves tables too), and the row in his dashboard's
 * nav is how he gets there.
 *
 * The greeting is the point of the name on this screen: the pad asked nobody
 * who he was, so this is the first and only place the session says out loud
 * whose it is — before he starts locking rounds under it.
 *
 * **The second step is the shift** (the owner, 23.09.2026). The café runs two a
 * day and they overlap while the crews change, so the clock can no longer say
 * whose round a round is: the worker does. The slot he taps is one of the
 * owner's own two, it is free **per screen** — the first shift is a konobar and
 * a šanker, so the colleague arriving five minutes later takes the other seat
 * rather than being pushed into the evening — and once he is on it the session
 * stays signed in until the šanker closes that shift. The seat outlives the
 * session: a worker who signs out on a shared phone is still named on his
 * slot, and still holds it, until he leaves the shift or it is closed.
 */
import type { ScreenMode, ShiftChoice } from '#shared/types'
import { MODE_LABELS } from '#shared/landing'

useHead({ title: 'Ekran' })

const api = useApi()
const me = useMe()

const ready = ref(false)
const busy = ref<string | null>(null)
const message = ref<string | null>(null)

/**
 * Which half of the screen is showing.
 *
 * Read off the session rather than held as state, so a reload in the middle —
 * screen answered, shift not — comes back to the shift and never asks the first
 * question twice.
 */
const step = computed<'mode' | 'shift'>(() => (me.me.value?.session.mode ? 'shift' : 'mode'))

const choices = ref<ShiftChoice[]>([])
const loadingChoices = ref(false)

onMounted(async () => {
  const state = await me.load()
  if (state !== 'ready' || !me.user.value) {
    // No session: back to the pad. Offline keeps whatever we last knew rather
    // than throwing somebody off a screen because the wifi blinked.
    if (state !== 'offline') await navigateTo('/')
    return
  }
  if (me.user.value.role === 'admin') {
    await navigateTo('/admin')
    return
  }
  ready.value = true
  if (step.value === 'shift') await loadChoices()
})

/**
 * Read fresh every time this half opens, and again after a refusal: the seat a
 * phone is looking at is one a colleague at the bar can take while it looks.
 */
async function loadChoices() {
  loadingChoices.value = true
  try {
    choices.value = (await api.shiftChoices()).choices
    message.value = null
  } catch (err) {
    message.value = apiErrorText(err)
  } finally {
    loadingChoices.value = false
  }
}

/** The choices, in the order the café thinks of them. */
const CHOICES: { mode: ScreenMode, note: string }[] = [
  { mode: 'konobar', note: 'Stolovi, narudžbe i naplata.' },
  { mode: 'sanker', note: 'Priprema, šank i zaliha.' },
]

async function choose(mode: ScreenMode) {
  if (busy.value) return
  busy.value = mode
  message.value = null
  try {
    // The route answers the whole `MeContext`, so the session's new mode is on
    // the store before `step` is read again.
    me.me.value = await api.setMode({ mode })
    // Still here rather than navigating: `home` is the chooser until the shift
    // is answered too, and asking the server to send him somewhere he cannot go
    // yet would be a redirect straight back.
    await loadChoices()
  } catch (err) {
    message.value = apiErrorText(err)
  } finally {
    busy.value = null
  }
}

async function chooseShift(choice: ShiftChoice) {
  if (busy.value || choice.action === null) return
  busy.value = choice.template_id
  message.value = null
  try {
    me.me.value = await api.setShift({ template_id: choice.template_id })
    await navigateTo(me.home.value)
  } catch (err) {
    message.value = apiErrorText(err)
    // The refusal is almost always "somebody just took it", so redraw the
    // seats instead of leaving a card that still looks free.
    await loadChoices()
  } finally {
    busy.value = null
  }
}

/** Wrong screen picked: back one step, without signing out. */
async function backToMode() {
  if (busy.value) return
  me.me.value = me.me.value && { ...me.me.value, session: { ...me.me.value.session, mode: null } }
}

/** What a card that cannot be tapped says, in the café's own words. */
const BLOCKED_BS: Record<NonNullable<ShiftChoice['blocked']>, string> = {
  zauzeta: 'Zauzeta',
  zavrsena: 'Završena',
  rano: 'Još nije vrijeme',
}

/**
 * Who is already on a slot — the line under its name.
 *
 * The name is the point of it: it is what tells Tarik at 07:05 that Nidal is
 * already the konobar of *Prva*, even when Nidal signed out on this very phone
 * a minute ago so Tarik could sign in. So the name is drawn in ink and the
 * seat's word beside it stays quiet.
 */
function crew(choice: ShiftChoice): { seat: string, name: string }[] {
  const on: { seat: string, name: string }[] = []
  if (choice.konobar) on.push({ seat: 'konobar', name: choice.konobar })
  if (choice.sanker) on.push({ seat: 'šank', name: choice.sanker })
  return on
}

/** The line under a slot with nobody on it. */
function nobody(choice: ShiftChoice): string {
  return choice.shift_id ? 'otvorena, niko nije prijavljen' : 'nije otvorena'
}

async function signOut() {
  if (busy.value) return
  await me.logout()
}
</script>

<template>
  <main class="chooser">
    <div class="chooser-glow" aria-hidden="true" />

    <div class="chooser-inner">
      <ClientOnly>
        <section v-if="!ready" class="stage stage-quiet">
          <p class="stage-sub">Učitavanje…</p>
        </section>

        <template v-else>
          <header class="hello">
            <span class="avatar avatar-lg avatar-accent">{{ me.user.value?.initials }}</span>
            <p class="eyebrow">Zdravo, {{ me.user.value?.name }}</p>
            <h1 class="page-title hello-title">
              {{ step === 'mode' ? 'Na čemu si večeras?' : 'Koju smjenu radiš?' }}
            </h1>
          </header>

          <p v-if="message" class="note note-danger">{{ message }}</p>

          <div v-if="step === 'mode'" class="choices">
            <button
              v-for="choice in CHOICES"
              :key="choice.mode"
              type="button"
              class="choice"
              :disabled="busy !== null"
              @click="choose(choice.mode)"
            >
              <span class="section-title choice-name">{{ MODE_LABELS[choice.mode] }}</span>
              <span class="choice-note">{{ choice.note }}</span>
            </button>
          </div>

          <!--
            The café's two slots, always both drawn. A slot he cannot take is
            greyed with the reason rather than hidden: *Druga smjena* missing
            from the screen at eight in the morning would read as a fault, and
            *Zauzeta* with a colleague's name on it is the one sentence that
            stops two people taking one seat.
          -->
          <template v-else>
            <p v-if="loadingChoices && choices.length === 0" class="choice-note">Učitavanje…</p>

            <div v-else class="choices">
              <button
                v-for="choice in choices"
                :key="choice.template_id"
                type="button"
                class="choice"
                :disabled="busy !== null || choice.action === null"
                @click="chooseShift(choice)"
              >
                <span class="shift-head">
                  <span class="section-title choice-name">{{ choice.name }}</span>
                  <span v-if="choice.mine" class="chip chip-accent">tvoja</span>
                  <span v-else-if="choice.blocked" class="chip">{{ BLOCKED_BS[choice.blocked] }}</span>
                </span>
                <span class="choice-note num">{{ choice.start_time }} – {{ choice.end_time }}</span>
                <span v-if="crew(choice).length > 0" class="choice-note">
                  <template v-for="(on, i) in crew(choice)" :key="on.seat">
                    <span v-if="i > 0" aria-hidden="true"> · </span>
                    {{ on.seat }} <strong class="crew-name">{{ on.name }}</strong>
                  </template>
                </span>
                <span v-else class="choice-note">{{ nobody(choice) }}</span>
              </button>
            </div>

            <button type="button" class="more quiet" :disabled="busy !== null" @click="backToMode">
              <span>Nisam na tom ekranu — vrati se</span>
            </button>
          </template>

          <!-- Not a way out of the shift, a way out of the wrong session: the
               pad named nobody, so this is where a person who is looking at
               somebody else's name says so. -->
          <button type="button" class="more quiet" :disabled="busy !== null" @click="signOut">
            <span>Nisam ja — odjavi se</span>
          </button>
        </template>

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
.chooser {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 24px 0 32px;
}

/* The same light source as the login screen, because this is the same moment. */
.chooser-glow {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: radial-gradient(
    760px 420px at 50% 0%,
    color-mix(in oklab, var(--accent) 15%, transparent) 0%,
    color-mix(in oklab, var(--accent) 6%, transparent) 38%,
    transparent 78%
  );
}

.chooser-inner {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 460px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.hello {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
}

.hello-title { margin: 0; }
.hello p { margin: 0; }

.note { margin: 0; }

/* ---- the two choices --------------------------------------------------- */

/* One under the other on a phone — a thumb reaches down, not across — and two
   equal halves the moment there is room for them. */
.choices {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
}

.choice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 4px;
  min-height: 112px;
  padding: 20px;
  text-align: left;
  border-radius: var(--radius-card);
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.045);
  transition:
    background var(--dur-fast) var(--ease-standard),
    border-color var(--dur-fast) var(--ease-standard),
    transform var(--dur-tap) var(--ease-standard);
}

.choice:active:not(:disabled) {
  background: var(--surface-2);
  border-color: var(--accent-line);
  transform: scale(0.98);
}

.choice:disabled { opacity: 0.5; cursor: default; }

.choice-name { color: var(--ink); }

/* The name and its chip on one line, the chip pushed to the far edge so two
   cards read as a column of names rather than as a ragged list. */
.shift-head {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
}

.shift-head .chip { margin-left: auto; }

.choice-note {
  font-size: var(--text-label);
  color: var(--muted);
}

/* The colleague already on a seat — the one word on the card worth reading
   before tapping it. */
.crew-name {
  color: var(--ink);
  font-weight: 600;
}

/* ---- the foot ---------------------------------------------------------- */

.more {
  display: flex;
  align-items: center;
  min-height: 48px;
  padding: 0 4px;
  border: 0;
  border-top: 1px solid var(--line-soft);
  background: transparent;
  font-size: var(--text-label);
  font-weight: 600;
  cursor: pointer;
}

.more > span { flex-grow: 1; text-align: left; }
.quiet { color: var(--muted); }
.quiet:disabled { opacity: 0.5; cursor: default; }

.stage {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px 20px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
}

.stage-quiet {
  min-height: 180px;
  align-items: center;
  justify-content: center;
}

.stage-sub {
  margin: 0;
  font-size: var(--text-label);
  color: var(--muted);
}

@media (min-width: 560px) {
  .choices { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .choice { min-height: 148px; }
}
</style>
