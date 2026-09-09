<script setup lang="ts">
/**
 * *Nargila* — the monthly tobacco reconciliation, per aroma.
 *
 * The whole report is one subtraction the owner already does on paper:
 * *početno + primljeno − završno = potrošeno*, and *potrošeno ÷ grama po luli =
 * očekivano lula*. When more bowls' worth of tobacco left the tins than the till
 * ever charged for, that difference is the number worth talking about — and the
 * page says "lula bez narudžbe", never who did it.
 *
 * `estimated` matters and is always shown: when no popis was confirmed inside
 * the month, *završno* is the ledger's theoretical figure and not a counted one,
 * so the difference is an estimate too.
 */
import { businessDate } from '#shared/dates'
import type { NargilaReport } from '#shared/types'
import type { UiColumn } from '~/components/ui/UiTable.vue'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Roba — nargila' })

const api = useAdminApi()
const route = useRoute()
const router = useRouter()

const report = ref<NargilaReport | null>(null)
const loading = ref(true)
const error = ref('')

/** The months the owner picks from: this one and the eleven behind it. */
const MONTH_NAMES = [
  'januar', 'februar', 'mart', 'april', 'maj', 'juni',
  'juli', 'august', 'septembar', 'oktobar', 'novembar', 'decembar',
]

/** "2026-09" → "septembar 2026". Never through `getMonth()` on a raw Date. */
function monthLabel(month: string): string {
  const [year, index] = month.split('-')
  const name = MONTH_NAMES[Number(index) - 1] ?? month
  return `${name} ${year}`
}

const MONTH = /^\d{4}-\d{2}$/

/** Today's business month — 02:30 on the first still belongs to last month. */
const thisMonth = computed(() => businessDate(new Date().toISOString()).slice(0, 7))

const month = computed(() => {
  const asked = String(route.query.month ?? '')
  return MONTH.test(asked) ? asked : thisMonth.value
})

const options = computed(() => {
  const [year, index] = thisMonth.value.split('-').map(Number)
  const list: Array<{ value: string, label: string }> = []
  for (let back = 0; back < 12; back += 1) {
    // Date.UTC normalises a month that has run off the start of the year.
    const at = new Date(Date.UTC(year!, index! - 1 - back, 1))
    const key = `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`
    list.push({ value: key, label: monthLabel(key) })
  }
  return list
})

const picked = computed({
  get: () => month.value,
  set: (value: string) => {
    void router.replace({ query: { ...route.query, month: value } })
  },
})

async function load() {
  loading.value = true
  try {
    report.value = await api.getNargila(month.value)
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
watch(month, () => { void load() })

const COLUMNS: UiColumn[] = [
  { key: 'name', label: 'Aroma' },
  { key: 'start', label: 'Početno g', align: 'r' },
  { key: 'in', label: 'Primljeno g', align: 'r' },
  { key: 'end', label: 'Završno g', align: 'r' },
  { key: 'used', label: 'Potrošeno g', align: 'r' },
]

/**
 * Grams with the Bosnian thousands dot: 5.000.
 *
 * It borrows the money formatter (feninga → "5.000,00") and drops the decimals,
 * so the separators here are the same ones every amount on `/a` uses. Grams are
 * whole numbers, so nothing is lost in the rounding.
 */
function grams(value: number): string {
  return formatAmount(Math.round(value) * 100).replace(',00', '')
}

/** Kilos when the number is big enough to be unreadable in grams. */
function kg(value: number): string {
  return formatStockQty(value, 'g')
}
</script>

<template>
  <div class="a-page">
    <RobaTabs :sub="`nargila · ${monthLabel(month)}`">
      <template #actions>
        <select v-model="picked" class="a-month" aria-label="Mjesec">
          <option v-for="option in options" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </template>
    </RobaTabs>

    <p v-if="error" class="a-error">{{ error }}</p>

    <div v-if="report" class="a-tiles">
      <UiTile label="Potrošeno duhana" :value="kg(report.potroseno_g)" :sub="`primljeno ${kg(report.primljeno_g)}`" />
      <UiTile label="Očekivano lula" :value="report.ocekivano_lula" :sub="`po ${report.gpb_norm} g po luli`" />
      <UiTile label="Prodano lula" :value="report.prodano_lula" sub="naplaćeno kroz narudžbe" />
      <UiTile
        label="Razlika"
        :value="`${report.razlika_lula} lula`"
        :tone="report.razlika_lula > 0 ? 'warn' : 'good'"
        :sub="report.razlika_lula > 0 ? `${formatKm(report.razlika_fen)} bez narudžbe` : 'sve se poklapa'"
      />
      <UiTile
        label="Grama po luli"
        :value="report.grams_per_bowl === null ? '—' : String(Math.round(report.grams_per_bowl))"
        :tone="report.grams_per_bowl === null ? 'plain' : report.within_band ? 'good' : 'warn'"
        :sub="report.grams_per_bowl === null
          ? 'nije prodana nijedna lula'
          : report.within_band ? 'u očekivanom rasponu' : 'van očekivanog raspona'"
      />
      <UiTile
        label="Završno stanje"
        :value="kg(report.zavrsno_g)"
        :sub="report.estimated ? 'procijenjeno — nema potvrđenog popisa' : 'iz potvrđenog popisa'"
      />
    </div>

    <RobaReport
      v-if="report"
      title="Po aromama"
      :count="`${report.items.length}`"
      :columns="COLUMNS"
      :loading="loading"
      :is-empty="report.items.length === 0"
      empty="U ovom mjesecu nije bilo duhana na stanju."
    >
      <template #chips>
        <span class="chip">početno {{ kg(report.pocetno_g) }}</span>
        <span class="op">+</span>
        <span class="chip">primljeno {{ kg(report.primljeno_g) }}</span>
        <span class="op">−</span>
        <span class="chip">završno {{ kg(report.zavrsno_g) }}</span>
        <span class="op">=</span>
        <span class="chip on">potrošeno {{ kg(report.potroseno_g) }}</span>
        <span class="op">÷</span>
        <span class="chip">{{ report.gpb_norm }} g</span>
        <span class="op">=</span>
        <span class="chip on">očekivano {{ report.ocekivano_lula }} lula</span>
      </template>

      <tr v-for="item in report.items" :key="item.stock_item_id">
        <td>
          {{ item.item_name }}
          <small v-if="item.estimated" class="a-est">procijenjeno završno</small>
        </td>
        <td class="r">{{ grams(item.pocetno_g) }}</td>
        <td class="r">{{ grams(item.primljeno_g) }}</td>
        <td class="r">{{ grams(item.zavrsno_g) }}</td>
        <td class="r">{{ grams(item.potroseno_g) }}</td>
      </tr>

      <tr class="a-total">
        <td>Ukupno</td>
        <td class="r">{{ grams(report.pocetno_g) }}</td>
        <td class="r">{{ grams(report.primljeno_g) }}</td>
        <td class="r">{{ grams(report.zavrsno_g) }}</td>
        <td class="r">{{ grams(report.potroseno_g) }}</td>
      </tr>

      <template #foot>
        <p class="a-muted">
          Razlika se računa na cijeli mjesec, ne po osobi. Broj je povod za razgovor,
          a ne optužba.
        </p>
      </template>
    </RobaReport>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.a-error { margin: 0; color: var(--danger); font-size: 14px; }
.a-muted { margin: 0; color: var(--muted); font-size: 13px; }
.a-est { display: block; font-size: 12px; color: var(--muted); }

.a-tiles { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }

.a-total { font-weight: 600; }

.a-month {
  height: 36px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  padding: 0 10px;
}

@media (max-width: 1023px) {
  .a-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .a-month { height: 44px; font-size: 15px; }
}
</style>
