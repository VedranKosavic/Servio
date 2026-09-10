<script setup lang="ts">
/**
 * S12 *Pravila* — the published house rules, and the one screen that can stand
 * in front of the floor plan.
 *
 * Three layers, in this order, and each is here for a different reason:
 *
 * 1. **The published document.** `rules.body_md`, written by the owner on
 *    `/admin/postavke/pravila` and versioned; a correction is a new version, never
 *    an edit. The `{{…}}` thresholds inside it are filled from
 *    `me.venue.settings` at render time, so a number changed in *Podešavanja*
 *    changes here on every phone **without** a new version — which is the whole
 *    point of publishing rules instead of printing them.
 * 2. **The thresholds**, listed in full whether or not the document quotes
 *    them. A venue that has published nothing still owes its staff the numbers.
 * 3. **The fairness contract** (PLAN §8, F12): what a flag means, what the app
 *    records, and the honest paragraph about the database file. Those are the
 *    app's promises, not the owner's text, so they are not editable from `/admin`.
 *
 * **The gate.** On the first login after a new version this screen stands in
 * front of S1 with no *Kasnije*: `app/middleware/pravila.global.ts` sends every
 * dark route here while `useRules().gateActive` is true, and *Potvrđujem* is
 * disabled until the text has actually been scrolled to the end. It is a client
 * rule only — the server never refuses an order over it (PHASE4 §2.8) — and it
 * never appears mid-shift.
 */
import { localDate } from '#shared/dates'

useHead({ title: 'Pravila' })

const me = useMe()
const rules = useRules()
// Destructured so the template reads `view`, not `rules.view.value`: a ref
// returned at the top level of `<script setup>` is unwrapped in the template,
// one nested inside an object is not.
const { view, error, acking, published, mustAck, gateActive: gate } = rules

const settings = computed(() => me.settings.value)
const blocks = computed(() => renderRules(view.value?.body_md ?? '', settings.value))

onMounted(async () => {
  if (!await me.requireSession()) return
  await rules.ensure()
})

/**
 * The one timer this screen has is the app's one timer. `rules_version` moving
 * means the owner published while somebody was reading: the text is refetched
 * so the page stops lying, and the gate deliberately does not appear — that
 * waits for the next login (`useRules().onVersion`).
 */
useChanges({
  raw: (result) => { void rules.onVersion(result.rules_version) },
})

/**
 * Has he reached the end of the text?
 *
 * An `IntersectionObserver` on an empty div after the last section, rather than
 * scroll arithmetic: it is one line, it is right on a short document (the mark
 * is already visible, so the button is enabled immediately) and it does not fire
 * on every scroll event.
 */
const endMark = ref<HTMLElement | null>(null)
const reachedEnd = ref(false)

useIntersectionObserver(endMark, (entries) => {
  if (entries.some(entry => entry.isIntersecting)) reachedEnd.value = true
})

/**
 * *Potvrđujem*, from PLAN §12's glossary, with the version named.
 *
 * PLAN §10 writes this button as "Pročitao sam Pravila v3" and the done-when in
 * PHASE4 calls it *Potvrđujem*; the glossary word wins because it is the one
 * that works for Lejla as well as for Amar — "pročitao sam" is a man saying it,
 * and half the staff is not one.
 */
const ackLabel = computed(() => `Potvrđujem Pravila v${view.value?.version ?? 1}`)
const canAck = computed(() => reachedEnd.value && !acking.value)

async function confirm() {
  const wasGate = gate.value
  if (!await rules.ack()) return
  // Straight to work. Anywhere else would be a second tap for nothing.
  if (wasGate) await navigateTo(me.home.value)
}

/** "10.09.2026. 22:41" — the same zone every other screen renders. */
function stamp(iso: string | null): string {
  if (!iso) return ''
  return `${localDate(iso)} ${clockHm(iso)}`
}
</script>

<template>
  <ClientOnly>
    <div class="flex flex-1 flex-col">
      <WaiterHeader title="Pravila" :back-to="gate ? undefined : '/konobar/moja-smjena'">
        <template #right>
          <span v-if="gate" class="chip chip-warn">Potvrdi da nastaviš</span>
          <WaiterSyncChip v-else compact />
        </template>
      </WaiterHeader>

      <main class="flex flex-1 flex-col gap-4 py-4" :class="mustAck ? 'pb-28' : ''">
        <section v-if="gate" class="card flex flex-col gap-2 p-4">
          <h2 class="text-section font-bold text-warn">
            Nova verzija Pravila
          </h2>
          <p class="text-label text-text-2">
            Objavljena je verzija v{{ view?.version }}. Pročitaj je do kraja i
            potvrdi — poslije toga ideš na svoj ekran. Ovo se pita jednom po
            verziji i nikad usred smjene.
          </p>
        </section>

        <p v-if="error" class="card px-4 py-3 text-label text-danger" role="alert">
          {{ error }}
        </p>

        <p class="text-body text-text-2">
          Ovo su pravila po kojima se radi u ovom lokalu. Pišu ovdje zato što
          pravilo koje ne znaš unaprijed nije pravilo.
        </p>

        <section v-if="published" class="card flex flex-col gap-3 p-4">
          <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span class="section-title">Pravila v{{ view?.version }}</span>
            <span class="text-caption tracking-normal text-muted">
              objavio {{ view?.published_by_name }} · {{ stamp(view?.published_at ?? null) }}
            </span>
          </div>
          <PravilaDoc :blocks="blocks" class="text-label text-text-2" />
        </section>

        <p v-else class="card px-4 py-6 text-center text-label text-text-2">
          Pisana pravila još nisu objavljena. Brojevi ispod vrijede i bez njih.
        </p>

        <h2 class="px-1 text-section font-bold">
          Pragovi
        </h2>
        <PravilaPragovi :settings="settings" />

        <PravilaFer :settings="settings" />

        <p
          v-if="view?.my_ack_version"
          class="px-1 text-caption tracking-normal text-muted"
        >
          Potvrđena verzija v{{ view.my_ack_version }} · {{ stamp(view.my_ack_at) }}
        </p>

        <!-- The end of the text. Seeing this is what enables *Potvrđujem*. -->
        <div ref="endMark" aria-hidden="true" class="h-px w-full" />
      </main>

      <div
        v-if="mustAck"
        class="sticky bottom-0 -mx-4 border-t border-line bg-bg px-4 pb-[env(safe-area-inset-bottom)] pt-3"
      >
        <p v-if="!reachedEnd" class="pb-2 text-center text-caption tracking-normal text-muted">
          Pročitaj tekst do kraja.
        </p>
        <button
          type="button"
          class="btn btn-primary h-14 w-full text-body"
          :disabled="!canAck"
          @click="confirm"
        >
          {{ acking ? 'Potvrđujem…' : ackLabel }}
        </button>
      </div>
    </div>

    <template #fallback>
      <p class="py-10 text-center text-text-2">
        Učitavanje…
      </p>
    </template>
  </ClientOnly>
</template>
