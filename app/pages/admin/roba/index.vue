<script setup lang="ts">
/**
 * *Stanje šanka* — what is on the shelf tonight, and the four nag lists.
 *
 * Four reads, one poll. `useAdminChanges` is the dashboard's single timer: this
 * page does not open one of its own, it says which entities matter (`stock` and
 * `count`) and refetches only when one of them moves.
 */
import {
  buildStanjeRows, matchesFilter,
  type StanjeFilter, type StanjeRow,
} from '~/components/roba/RobaStanjeTable.vue'
import type { CountView, OwnerStockReport, ProductAdmin, StockItem } from '#shared/types'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Roba — stanje šanka' })

const api = useAdminApi()

const report = ref<OwnerStockReport | null>(null)
const live = ref<StockItem[]>([])
const products = ref<ProductAdmin[]>([])
const counts = ref<CountView[]>([])
const loading = ref(true)
const error = ref('')
const filter = ref<StanjeFilter>('sve')

async function load() {
  try {
    // Four independent reads, so they go out together rather than in a chain.
    const [stockReport, stockLive, menu, confirmed] = await Promise.all([
      api.getOwnerStock(),
      api.getStock(),
      api.getProducts(),
      api.getCounts({ status: 'confirmed' }),
    ])
    report.value = stockReport
    live.value = stockLive.items
    products.value = menu
    counts.value = confirmed
    error.value = ''
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

useAdminChanges({
  onEntity: (entity) => {
    if (entity === 'stock' || entity === 'count' || entity === 'menu') void load()
  },
})

// The session is an httpOnly cookie the browser holds, so every read on `/admin`
// happens after mount — a server render would ask `/api/me` with no cookie jar
// and be told nobody is logged in. `middleware/admin.ts` says the same thing.
onMounted(() => { void load() })

const rows = computed<StanjeRow[]>(() =>
  buildStanjeRows(report.value?.items ?? [], live.value, products.value, counts.value))

const shown = computed(() => rows.value.filter(row => matchesFilter(row, filter.value)))

/** The four chips, each with the count of the rows it would leave standing. */
const CHIPS: Array<{ key: StanjeFilter, label: string }> = [
  { key: 'u-minusu', label: 'U minusu' },
  { key: 'bez-cijene', label: 'Bez cijene' },
  { key: 'bez-normativa', label: 'Bez normativa' },
  { key: 'kasno', label: 'Kasno sinhronizovano' },
]

function chipCount(key: StanjeFilter): number {
  return rows.value.filter(row => matchesFilter(row, key)).length
}

/** A second tap on the active chip clears it — the chips are one filter, not four. */
function toggle(key: StanjeFilter) {
  filter.value = filter.value === key ? 'sve' : key
}

const totals = computed(() => report.value?.totals ?? null)
</script>

<template>
  <div class="a-page">
    <RobaTabs sub="stanje šanka · sve što stoji na polici">
      <template #actions>
        <UiButton variant="ghost" @click="navigateTo('/admin/roba/pocetno-stanje')">
          Početno stanje
        </UiButton>
      </template>
    </RobaTabs>

    <p v-if="error" class="a-error">{{ error }}</p>

    <div class="a-tiles">
      <UiTile label="Vrijednost zaliha" :value="formatKm(totals?.value_fen ?? 0)" :sub="`${totals?.items ?? 0} artikala`" />
      <UiTile label="U minusu" :value="totals?.u_minusu ?? 0" :tone="(totals?.u_minusu ?? 0) > 0 ? 'bad' : 'plain'" sub="ledger kaže da polica duguje" />
      <UiTile label="Nisko" :value="totals?.nisko ?? 0" :tone="(totals?.nisko ?? 0) > 0 ? 'warn' : 'plain'" sub="na minimumu ili ispod" />
      <UiTile label="Bez cijene" :value="totals?.bez_cijene ?? 0" :tone="(totals?.bez_cijene ?? 0) > 0 ? 'warn' : 'plain'" sub="svaki iznos od njih je 0,00 KM" />
    </div>

    <UiCard title="Stanje šanka" :count="`${shown.length} od ${rows.length}`">
      <RobaStanjeTable :rows="shown" :loading="loading" />

      <div class="a-chips">
        <button
          v-for="chip in CHIPS"
          :key="chip.key"
          type="button"
          class="a-chip"
          :class="{ on: filter === chip.key }"
          :aria-pressed="filter === chip.key"
          @click="toggle(chip.key)"
        >{{ chip.label }} {{ chipCount(chip.key) }}</button>
        <button
          v-if="filter !== 'sve'"
          type="button"
          class="a-chip"
          @click="filter = 'sve'"
        >Prikaži sve</button>
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 18px; min-width: 0; }

.a-tiles {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.a-error { margin: 0; color: var(--danger); font-size: 14px; }

.a-chips { display: flex; flex-wrap: wrap; gap: 6px; }

.a-chip {
  height: 28px;
  padding: 0 10px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: var(--surface);
  font: inherit;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
  cursor: pointer;
}

.a-chip.on { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }

@media (max-width: 1023px) {
  /* Tiles two-up, and every chip a thumb's target. */
  .a-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .a-chip { height: 44px; padding: 0 14px; font-size: 15px; }
}
</style>
