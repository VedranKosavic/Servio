<script setup lang="ts">
/**
 * *Na čemu si večeras?* — the second step, and the only one behind the PIN.
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
 */
import type { ScreenMode } from '#shared/types'
import { MODE_LABELS } from '#shared/landing'

useHead({ title: 'Ekran' })

const api = useApi()
const me = useMe()

const ready = ref(false)
const busy = ref<ScreenMode | null>(null)
const message = ref<string | null>(null)

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
})

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
    // the store before the navigation reads `home` out of it.
    me.me.value = await api.setMode({ mode })
    await navigateTo(me.home.value)
  } catch (err) {
    message.value = apiErrorText(err)
  } finally {
    busy.value = null
  }
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
            <h1 class="page-title hello-title">Na čemu si večeras?</h1>
          </header>

          <p v-if="message" class="note note-danger">{{ message }}</p>

          <div class="choices">
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

.choice-note {
  font-size: var(--text-label);
  color: var(--muted);
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
