<script setup lang="ts">
/**
 * S11 *Moja smjena* — what the shift sold, and the pazar it took.
 *
 * **Two things, on the owner's call (16.09.2026), and nothing else.** The
 * screen used to be a night's worth of cards: counts before the envelope,
 * money after it, the last thirty nights with a *Napomena* on each, *Moji sati*
 * and *Moji podaci*. All of it is gone, together with the drill-down it opened
 * (`/konobar/moja-smjena/stavke`) and the blindness strip the counts card was
 * built around — a worker now reads the article list and the total the moment
 * the round is locked, without waiting for the šanker to close the night.
 *
 * The rows are the **shift's**, not the reader's: a šanker locks no round of his
 * own, and the pazar he is about to hand over is the night's. Nothing here is
 * split by person, so no colleague's money appears on anybody's screen
 * (invariant 9 is about `/me/*` naming nobody, and this read still names
 * nobody).
 *
 * `GET /api/me/shift` is the one read, and the app's one poll keeps it current.
 * The server routes behind the deleted cards (`/api/me/shifts`,
 * `/api/me/sessions`, the *Napomena* PUT and `/api/me/shift/lines`) are
 * untouched and still guarded; no screen calls them any more.
 */
import { formatKm } from '#shared/money'
import { shortDateBs } from '#shared/dates'
import type { SoldNight } from '#shared/types'

useHead({ title: 'Moja smjena' })

const api = useApi()
const me = useMe()
useOutbox()

/**
 * The screen follows the night on the app's one poll: a round locked by a
 * colleague, a storno decided at the bar or the šanker closing the shift all
 * land here without a reload. `quiet` keeps the skeleton for the first paint
 * only — a refetch must not blank numbers somebody is reading.
 */
useChanges({
  raw: (result) => {
    if (result.full) return
    if (result.changes.some(c => c.entity === 'shift' || c.entity === 'adjustment')) {
      void load(true)
    }
  },
  me: () => me.load(),
})

const sold = ref<SoldNight | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)

onMounted(async () => {
  if (!(await me.requireSession())) return
  await load()
})

async function load(quiet = false) {
  if (!quiet) loading.value = true
  loadError.value = null
  try {
    sold.value = (await api.getMyShift()).sold
  } catch (err) {
    if (!(await me.handleAuthError(err))) loadError.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

/** *Večeras*, or the date of the night that was closed last. */
const title = computed(() => {
  if (!sold.value || sold.value.open) return 'Večeras'
  return sold.value.business_date ? shortDateBs(sold.value.business_date) : 'Zadnja smjena'
})
</script>

<template>
  <ClientOnly>
    <div class="flex flex-1 flex-col">
      <WaiterHeader title="Moja smjena" :back-to="me.home.value">
        <template #right>
          <WaiterSyncChip compact />
        </template>
      </WaiterHeader>

      <WaiterOutboxBanner />

      <main class="flex flex-1 flex-col gap-4 py-4">
        <p v-if="loading" class="py-10 text-center text-text-2">
          Učitavanje…
        </p>

        <!-- A screen that could not refresh says so; it never shows an old
             number as if it were current (PHASE3 §4, "Honesty"). -->
        <div v-else-if="loadError" class="card flex flex-col gap-3 p-4 text-center">
          <p class="text-danger">
            {{ loadError }}
          </p>
          <button type="button" class="btn btn-ghost" @click="load">
            Pokušaj ponovo
          </button>
        </div>

        <template v-else-if="sold">
          <!-- Prodani artikli -->
          <section class="card flex flex-col gap-1 p-4">
            <h2 class="section-title">
              {{ title }}
            </h2>

            <div v-if="sold.rows.length" class="flex flex-col">
              <div
                v-for="row in sold.rows"
                :key="row.name"
                class="flex items-center justify-between gap-3 border-t border-line py-3 first:border-t-0"
              >
                <div class="flex min-w-0 items-baseline gap-2">
                  <span class="num shrink-0 font-semibold">{{ row.qty }}×</span>
                  <span class="truncate text-body">{{ row.name }}</span>
                </div>
                <span class="num shrink-0 text-body font-semibold">{{ formatKm(row.fen) }}</span>
              </div>
            </div>

            <p v-else class="py-6 text-center text-text-2">
              Još nijedan artikal večeras.
            </p>
          </section>

          <!-- Ukupan pazar smjene -->
          <section class="card flex items-center justify-between gap-3 p-4">
            <span class="section-title">Ukupan pazar</span>
            <span class="num metric">{{ formatKm(sold.total_fen) }}</span>
          </section>
        </template>
      </main>
    </div>

    <template #fallback>
      <p class="py-10 text-center text-text-2">
        Učitavanje…
      </p>
    </template>
  </ClientOnly>
</template>
