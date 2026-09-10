<script setup lang="ts">
/**
 * *Kategorije* — what each category cost and what it earned, over a period.
 *
 * Two pairs of numbers that are easy to confuse and mean different things:
 *
 * - **Nabavka** is what was *bought* in the period (the invoices). **Utrošak**
 *   is what was *sold off the shelf*, at cost. A month with one big delivery
 *   has a large nabavka and a normal utrošak, and that is not a loss.
 * - **Bruto marža** is `prodaja − utrošak`, which is the honest margin.
 *   *Prodaja − nabavka* is beside it because it is the number the owner has in
 *   his head, and seeing the two side by side is what explains the difference.
 */
import type { CategoriesReport } from '#shared/types'
import type { UiColumn } from '~/components/ui/UiTable.vue'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Roba — kategorije' })

const api = useAdminApi()
const route = useRoute()

// `UiPeriod` builds its own `useAdminPeriod()` on the default fallback, so the
// wanted preset goes into the URL rather than into this call — otherwise the
// chip and the range would disagree. `GET /api/owner/categories` takes business
// days and turns them into instants itself, so no conversion is needed here.
const period = useAdminPeriod()
if (!route.query.period && !route.query.from) period.setPeriod('ovaj-mjesec')

const report = ref<CategoriesReport | null>(null)
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  try {
    report.value = await api.getCategories(period.range.value)
    error.value = ''
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

useAdminChanges({
  onEntity: (entity) => { if (entity === 'stock' || entity === 'count') void load() },
})

onMounted(() => { void load() })
watch(() => period.range.value, () => { void load() })

const COLUMNS: UiColumn[] = [
  { key: 'name', label: 'Kategorija' },
  { key: 'nabavka', label: 'Nabavka', align: 'r' },
  { key: 'prodaja', label: 'Prodaja', align: 'r' },
  { key: 'utrosak', label: 'Utrošak', align: 'r' },
  { key: 'marza', label: 'Bruto marža', align: 'r' },
  { key: 'pct', label: '%', align: 'r' },
  { key: 'otpis', label: 'Otpis / manjak', align: 'r' },
  { key: 'diff', label: 'Prodaja − nabavka', align: 'r' },
]

/** The margin as a whole percent, or a dash when nothing was sold. */
function marginPct(marza: number, prodaja: number): string {
  if (prodaja <= 0) return '—'
  return `${Math.round((marza / prodaja) * 100)} %`
}

const rows = computed(() => report.value?.rows ?? [])
const totals = computed(() => report.value?.totals ?? null)
</script>

<template>
  <div class="a-page">
    <RobaTabs :sub="`kategorije · ${period.label.value}`" />

    <p v-if="error" class="a-error">{{ error }}</p>

    <div class="a-tiles">
      <UiTile label="Nabavka" :value="formatKm(totals?.nabavka_fen ?? 0)" sub="fakture u periodu" />
      <UiTile label="Prodaja" :value="formatKm(totals?.prodaja_fen ?? 0)" sub="naplaćeno, bez storna" />
      <UiTile label="Utrošak" :value="formatKm(totals?.utrosak_fen ?? 0)" sub="prodano, po nabavnoj" />
      <UiTile
        label="Bruto marža"
        :value="formatKm(totals?.marza_fen ?? 0)"
        tone="good"
        :sub="`${marginPct(totals?.marza_fen ?? 0, totals?.prodaja_fen ?? 0)} od prodaje`"
      />
    </div>

    <RobaReport
      title="Po kategorijama"
      :count="`${rows.length}`"
      :columns="COLUMNS"
      :loading="loading"
      :is-empty="rows.length === 0"
      empty="U ovom periodu nema ni nabavke ni prodaje."
    >
      <template #actions>
        <span class="a-muted">{{ period.label.value }}</span>
      </template>

      <tr v-for="row in rows" :key="row.category_id">
        <td>{{ row.category_name }}</td>
        <td class="r"><UiMoney :fen="row.nabavka_fen" :currency="false" /></td>
        <td class="r"><UiMoney :fen="row.prodaja_fen" :currency="false" /></td>
        <td class="r"><UiMoney :fen="row.utrosak_fen" :currency="false" /></td>
        <td class="r"><UiMoney :fen="row.marza_fen" :currency="false" /></td>
        <td class="r">{{ marginPct(row.marza_fen, row.prodaja_fen) }}</td>
        <td class="r"><UiMoney :fen="row.otpis_fen" :currency="false" /></td>
        <td class="r"><UiMoney :fen="row.prodaja_fen - row.nabavka_fen" :currency="false" /></td>
      </tr>

      <tr v-if="totals" class="a-total">
        <td>Ukupno</td>
        <td class="r"><UiMoney :fen="totals.nabavka_fen" :currency="false" /></td>
        <td class="r"><UiMoney :fen="totals.prodaja_fen" :currency="false" /></td>
        <td class="r"><UiMoney :fen="totals.utrosak_fen" :currency="false" /></td>
        <td class="r"><UiMoney :fen="totals.marza_fen" :currency="false" /></td>
        <td class="r">{{ marginPct(totals.marza_fen, totals.prodaja_fen) }}</td>
        <td class="r"><UiMoney :fen="totals.otpis_fen" :currency="false" /></td>
        <td class="r"><UiMoney :fen="totals.prodaja_fen - totals.nabavka_fen" :currency="false" /></td>
      </tr>

      <template #foot>
        <UiPeriod />
        <p class="a-muted">
          Nabavka je ono što je kupljeno u periodu; utrošak je ono što je prodano
          sa police, po nabavnoj cijeni. Bruto marža je prodaja − utrošak.
        </p>
      </template>
    </RobaReport>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.a-error { margin: 0; color: var(--danger); font-size: 14px; }
.a-muted { margin: 0; color: var(--muted); font-size: 13px; }
.a-total { font-weight: 600; }

.a-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }

@media (max-width: 1023px) {
  .a-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
