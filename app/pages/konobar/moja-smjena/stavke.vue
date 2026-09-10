<script setup lang="ts">
/**
 * The lines behind one of his own numbers — `/konobar/moja-smjena/stavke?kat=`.
 *
 * Opened from a category chip on S11, or from *Storna*. It reads the route that
 * already exists, `GET /api/me/shift/lines?kat=`, which is scoped to the
 * session and takes no `user` parameter — there is one person on `/me` and
 * there is no way to ask about anybody else.
 *
 * **The footer keeps the blindness.** `totals` comes back `null` until he has
 * settled, so this screen shows the rows (whose per-line prices are his own
 * anyway — anybody who can add knows his number) and simply does not draw a
 * sum. That is the same nudge the strip is, said the same way: not a secret, a
 * sequence — count first, then be told.
 *
 * Paging is the server's keyset cursor, so a late round arriving mid-scroll
 * cannot make a line appear twice or vanish.
 */
import { formatKm } from '#shared/money'
import type { LineRow, LineTotals, MyShiftCounts } from '#shared/types'

useHead({ title: 'Stavke' })

const api = useApi()
const me = useMe()
const route = useRoute()

const kat = computed(() => (typeof route.query.kat === 'string' ? route.query.kat : 'sve'))

const rows = ref<LineRow[]>([])
const totals = ref<LineTotals | null>(null)
const cursor = ref<string | undefined>(undefined)
const categories = ref<MyShiftCounts['by_category']>([])

const loading = ref(true)
const loadingMore = ref(false)
const loadError = ref<string | null>(null)

onMounted(async () => {
  if (!(await me.requireSession())) return
  // The chip row at the top needs the same category names S11 draws, and
  // `GET /api/me/shift` is the read that already has them.
  try {
    categories.value = (await api.getMyShift()).counts.by_category
  } catch {
    // A chip row we could not build is not a reason to hide the lines.
  }
  await load()
})

watch(kat, () => { void load() })

async function load() {
  loading.value = true
  loadError.value = null
  rows.value = []
  cursor.value = undefined
  try {
    const page = await api.getMyShiftLines(kat.value)
    rows.value = page.rows
    totals.value = page.totals
    cursor.value = page.next_cursor
  } catch (err) {
    if (!(await me.handleAuthError(err))) loadError.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (!cursor.value || loadingMore.value) return
  loadingMore.value = true
  try {
    const page = await api.getMyShiftLines(kat.value, cursor.value)
    rows.value = [...rows.value, ...page.rows]
    cursor.value = page.next_cursor
  } catch (err) {
    if (!(await me.handleAuthError(err))) loadError.value = apiErrorText(err)
  } finally {
    loadingMore.value = false
  }
}

/** The fixed filters, plus one chip per category he actually sold tonight. */
const filters = computed(() => [
  { id: 'sve', label: 'Sve' },
  ...categories.value.map(c => ({ id: c.category_id, label: c.name })),
  { id: 'storno', label: 'Storna' },
  { id: 'gratis', label: 'Na račun kuće' },
  { id: 'nijeplaceno', label: 'Nije plaćeno' },
])

const STATUS_LABEL: Record<LineRow['status'], string> = {
  otvoreno: 'otvoreno',
  naplaceno: 'naplaćeno',
  nije_placeno: 'nije plaćeno',
  storno: 'storno',
  storno_na_cekanju: 'storno čeka',
  gratis: 'kuća časti',
}

const STATUS_CLASS: Record<LineRow['status'], string> = {
  otvoreno: 'chip',
  naplaceno: 'chip chip-good',
  nije_placeno: 'chip chip-danger',
  storno: 'chip chip-warn',
  storno_na_cekanju: 'chip chip-warn',
  gratis: 'chip chip-warn',
}
</script>

<template>
  <ClientOnly>
    <div class="flex flex-1 flex-col">
      <WaiterHeader title="Stavke" back-to="/konobar/moja-smjena">
        <template #right>
          <WaiterSyncChip compact />
        </template>
      </WaiterHeader>

      <!-- The filter chips scroll sideways; the page itself never does. -->
      <div class="-mx-4 overflow-x-auto px-4 py-3">
        <div class="flex w-max gap-2">
          <NuxtLink
            v-for="filter in filters"
            :key="filter.id"
            :to="`/konobar/moja-smjena/stavke?kat=${filter.id}`"
            class="flex min-h-12 shrink-0 items-center rounded-full px-4 text-base font-medium"
            :class="filter.id === kat
              ? 'bg-accent text-accent-ink'
              : 'bg-surface-2 text-text-2'"
          >
            {{ filter.label }}
          </NuxtLink>
        </div>
      </div>

      <main class="flex flex-1 flex-col gap-3 pb-4">
        <p v-if="loading" class="py-10 text-center text-text-2">
          Učitavanje…
        </p>

        <div v-else-if="loadError" class="card flex flex-col gap-3 p-4 text-center">
          <p class="text-danger">
            {{ loadError }}
          </p>
          <button type="button" class="btn btn-ghost" @click="load">
            Pokušaj ponovo
          </button>
        </div>

        <template v-else>
          <section v-if="rows.length" class="card flex flex-col px-4">
            <div
              v-for="row in rows"
              :key="row.line_id"
              class="flex items-start justify-between gap-3 border-t border-line py-3 first:border-t-0"
            >
              <div class="min-w-0">
                <div class="flex items-baseline gap-2">
                  <span v-if="row.qty !== 1" class="num shrink-0 font-semibold">{{ row.qty }}×</span>
                  <span class="truncate text-[17px]">{{ row.name_snapshot }}</span>
                </div>
                <div class="num text-sm text-text-2">
                  {{ row.table_name }} · {{ clockHm(row.at) }}
                </div>
                <div v-if="row.flavour_names.length" class="truncate text-sm text-text-2">
                  {{ row.flavour_names.join(' · ') }}
                </div>
                <div v-if="row.note" class="truncate text-sm text-text-2">
                  {{ row.note }}
                </div>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-1">
                <span class="num text-[17px] font-semibold">{{ formatKm(row.charged_fen) }}</span>
                <span :class="STATUS_CLASS[row.status]">{{ STATUS_LABEL[row.status] }}</span>
              </div>
            </div>
          </section>

          <p v-else class="card px-4 py-8 text-center text-text-2">
            Nema stavki u ovoj grupi večeras.
          </p>

          <button
            v-if="cursor"
            type="button"
            class="btn btn-ghost h-14"
            :disabled="loadingMore"
            @click="loadMore"
          >
            {{ loadingMore ? 'Učitavam…' : 'Prikaži još' }}
          </button>

          <!-- The footer is the blindness: null totals until he has settled. -->
          <section v-if="totals" class="card flex flex-col gap-1 p-4 text-[17px]">
            <div class="flex justify-between gap-3">
              <span class="text-text-2">Stavki</span>
              <span class="num font-semibold">{{ totals.rows }} · {{ totals.qty }} kom</span>
            </div>
            <div class="flex justify-between gap-3">
              <span class="text-text-2">Naplaćeno</span>
              <span class="num font-semibold">{{ formatKm(totals.charged_fen) }}</span>
            </div>
            <div v-if="totals.storno_fen" class="flex justify-between gap-3">
              <span class="text-text-2">Storno</span>
              <span class="num">{{ formatKm(totals.storno_fen) }}</span>
            </div>
            <div v-if="totals.gratis_fen" class="flex justify-between gap-3">
              <span class="text-text-2">Na račun kuće</span>
              <span class="num">{{ formatKm(totals.gratis_fen) }}</span>
            </div>
          </section>

          <p v-else-if="rows.length" class="px-1 text-[15px] text-text-2">
            Zbir vidiš kad predaš pazar. Stavke su tu — cijene su na svakoj.
          </p>
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
