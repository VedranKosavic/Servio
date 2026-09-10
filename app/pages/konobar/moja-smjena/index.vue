<script setup lang="ts">
/**
 * S11 *Moja smjena* — a waiter's own night, and the last thirty before it.
 *
 * **The order of the screen is the rule it enforces.** Before he has handed the
 * envelope in, the top card is counts and only counts: ture, stolovi, lule,
 * *"Nargila 34 · Kafa 52"*, storna with their status, *"Osoblje 1/2"*, sati.
 * Not one KM. After his own settlement, the same card becomes money — promet,
 * per category, gotovina, kartica, and the verdict in words. Nothing here
 * computes an expected amount; the money comes back on `GET /api/me/shift` only
 * once a settlement row exists (BACKEND §6.6).
 *
 * Below it: the last thirty nights with *Napomena* editable on any own row,
 * *Moji sati* (worked only — the roster is Phase 4 and its column is absent,
 * not zero), and *Moji podaci*, his own sign-ins.
 *
 * Everything on this page is about *him*. There is no colleague anywhere on it,
 * by construction: every route it reads is `/api/me/*`, which is scoped by the
 * session and takes no `user` parameter (invariant 9).
 */
import type { MyShift, MyShiftRow, MySession } from '#shared/types'

useHead({ title: 'Moja smjena' })

const api = useApi()
const me = useMe()
useOutbox()

const shift = ref<MyShift | null>(null)
const nights = ref<MyShiftRow[]>([])
const sessions = ref<MySession[]>([])

const loading = ref(true)
const loadError = ref<string | null>(null)
const noteError = ref<string | null>(null)

/**
 * Did the browser promise to keep our IndexedDB? WP0 asks once, after the first
 * PIN login (§2.4); this only reads the answer back. `null` means the browser
 * has no such API and the row is left off rather than guessed at.
 */
const persisted = ref<boolean | null>(null)

onMounted(async () => {
  if (!(await me.requireSession())) return
  await load()
  persisted.value = await readPersisted()
})

async function readPersisted(): Promise<boolean | null> {
  if (!import.meta.client || !navigator.storage?.persisted) return null
  try {
    return await navigator.storage.persisted()
  } catch {
    return null
  }
}

async function load() {
  loading.value = true
  loadError.value = null
  try {
    // Three reads, in parallel: none of them depends on another, and this
    // screen is opened between rounds.
    const [mine, history, mySessions] = await Promise.all([
      api.getMyShift(),
      api.getMyShifts(30),
      api.getMySessions(),
    ])
    shift.value = mine
    nights.value = history
    sessions.value = mySessions
  } catch (err) {
    if (!(await me.handleAuthError(err))) loadError.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

const settled = computed(() => shift.value?.settled === true)
const summary = computed(() => shift.value?.summary ?? null)
const settlement = computed(() => shift.value?.settlement ?? null)
const counts = computed(() => shift.value?.counts ?? null)

/**
 * Save one night's *Napomena*.
 *
 * Straight through `useApi` and **not** through the outbox: the outbox is money
 * and stock only (§2.2), and a note that failed to send is a note the person
 * can retype — nothing in the ledger depends on it. The row it changed is
 * patched in place, so a save does not scroll a thirty-row list back to the top.
 */
async function saveNote(shiftId: string, body: string) {
  noteError.value = null
  try {
    const result = await api.putShiftNote(shiftId, { body })
    const row = nights.value.find(n => n.shift_id === shiftId)
    if (row) row.note = result.note
  } catch (err) {
    if (!(await me.handleAuthError(err))) noteError.value = apiErrorText(err)
  }
}
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

        <template v-else>
          <!-- Tonight: counts until the envelope is in, money after it. -->
          <MineMoneyCard
            v-if="settled && summary && counts"
            :summary="summary"
            :settlement="settlement"
            :counts="counts"
          />
          <MineCountsCard
            v-else-if="counts"
            :counts="counts"
            :persisted="persisted"
          />

          <NuxtLink
            v-if="shift?.shift && !settled"
            to="/konobar/smjena"
            class="btn btn-accent h-14 text-lg"
          >
            Završi smjenu
          </NuxtLink>

          <p v-if="!shift?.shift" class="card px-4 py-6 text-center text-text-2">
            Nema otvorene smjene. Smjena se otvara prvom zaključanom turom.
          </p>

          <!-- The last thirty nights -->
          <section class="card flex flex-col gap-1 p-4">
            <h2 class="text-xl font-bold">
              Prošle noći
            </h2>
            <p v-if="noteError" class="rounded-xl bg-danger-soft px-3 py-2 text-[15px] text-danger" role="alert">
              {{ noteError }}
            </p>
            <div v-if="nights.length" class="flex flex-col">
              <MineNightRow
                v-for="row in nights"
                :key="row.shift_id"
                :row="row"
                :save="saveNote"
              />
            </div>
            <p v-else class="py-6 text-center text-text-2">
              Ovo ti je prva zabilježena smjena.
            </p>
          </section>

          <MineHoursCard :rows="nights" />

          <MineSessionsCard :sessions="sessions" />

          <NuxtLink to="/konobar/pravila" class="btn btn-ghost h-14">
            Pravila
          </NuxtLink>
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
