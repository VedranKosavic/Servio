<script setup lang="ts">
/**
 * *Analitika* — one month of the café, for the owner (16.09.2026).
 *
 * The page answers his list in the order he wrote it: what the month took (and
 * what was handed over), what of that was never paid for (*Otpis*, *Rashod*,
 * *Policija*, *Osoblje*), what it cost — goods, flavours and coal out of *Prijem
 * robe*, the day wages and the till payouts out of the closings, electricity,
 * water and rent typed in here — what is left after all of it, how the takings
 * rose and fell day by day and month by month, which days were best, and the
 * record night of each shift.
 *
 * Every number is the server's (`GET /api/owner/analitika`, written up in
 * `server/services/analytics.ts`); this page only lays them out. The one thing
 * it writes is a typed cost, and the answer to that write is the whole month
 * again, so nothing on screen is ever patched by hand.
 *
 * The month lives in the route query, like the period on *Smjene*: a tab left
 * open and reloaded comes back on the same month.
 */
import { formatKm } from '#shared/money'
import { shortDateBs, weekdayBs } from '#shared/dates'
import {
  addMonths, type ManualCostKind, MONTH_COST_KEYS, MONTH_COST_LABELS, MONTH_COST_SOURCES,
  MONTH_RE, monthLabelBs, monthShortBs, type MonthCostKey, UNPAID_KEYS, UNPAID_LABELS,
} from '#shared/analytics'
import type { MonthAnalytics } from '#shared/types'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Analitika' })

const api = useAdminApi()
const route = useRoute()
const router = useRouter()

const data = ref<MonthAnalytics | null>(null)
const loading = ref(true)
const error = ref('')

/** The month asked for in the URL, or `undefined` for "this month". */
const asked = computed(() => {
  const value = route.query.month
  return typeof value === 'string' && MONTH_RE.test(value) ? value : undefined
})

/**
 * The café's current month, as the server first answered it. Kept so the
 * *next* arrow stops there: a month that has not started has nothing to show.
 */
const currentMonth = ref<string | null>(null)

async function load() {
  try {
    const answer = await api.getAnalytics(asked.value ?? '')
    data.value = answer
    if (!asked.value && !currentMonth.value) currentMonth.value = answer.month
    error.value = ''
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

watch(asked, () => { void load() }, { immediate: true })

// Pazar moves with every round, goods with every delivery, and the typed costs
// bump `settings`. Nothing else on this page can go stale.
useAdminChanges({
  onEntity: (entity) => {
    if (entity === 'shift' || entity === 'stock' || entity === 'settings') void load()
  },
})

function goMonth(step: number) {
  if (!data.value) return
  void router.replace({ query: { ...route.query, month: addMonths(data.value.month, step) } })
}

const canGoNext = computed(() =>
  !!data.value && (currentMonth.value === null || data.value.month < currentMonth.value))

/** 1 smjena, 2–4 smjene, 5 smjena — and 21 smjena, 22 smjene, as Bosnian counts. */
function smjena(n: number): string {
  const tens = n % 100
  const ones = n % 10
  if (ones === 1 && tens !== 11) return 'smjena'
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return 'smjene'
  return 'smjena'
}

// -- the costs ----------------------------------------------------------------

const MANUAL = new Set<MonthCostKey>(['struja', 'voda', 'kirija'])

/** The small print under a cost: where it came from, or where it was carried from. */
function sourceOf(key: MonthCostKey): string {
  const d = data.value
  if (d && key === 'kirija' && d.manual.kirija.carried && d.manual.kirija.from_month) {
    return `Prenesena iz: ${monthLabelBs(d.manual.kirija.from_month)}`
  }
  return MONTH_COST_SOURCES[key]
}

const editing = ref<ManualCostKind | null>(null)
const editFen = ref<number | null>(null)
const saving = ref(false)
const saveError = ref('')

function openEdit(key: MonthCostKey) {
  if (!data.value || !MANUAL.has(key)) return
  editing.value = key as ManualCostKind
  editFen.value = data.value.costs[key]
  saveError.value = ''
}

async function saveEdit() {
  if (!data.value || !editing.value || editFen.value === null || editFen.value < 0) {
    saveError.value = 'Upiši iznos, npr. 120,00'
    return
  }
  saving.value = true
  try {
    data.value = await api.putMonthCost({
      month: data.value.month,
      kind: editing.value,
      amount_fen: editFen.value,
    })
    editing.value = null
  } catch (err) {
    saveError.value = apiErrorText(err)
  } finally {
    saving.value = false
  }
}

const editTitle = computed(() =>
  editing.value && data.value
    ? `${MONTH_COST_LABELS[editing.value]} · ${monthLabelBs(data.value.month)}`
    : '')

// -- the charts ---------------------------------------------------------------

/** The tallest bar is 100 %; a month with no pazar at all draws flat. */
function scale(values: number[]): (value: number) => number {
  const top = Math.max(0, ...values)
  return value => (top > 0 ? Math.max(value > 0 ? 2 : 0, Math.round((value / top) * 100)) : 0)
}

const dayBars = computed(() => {
  const d = data.value
  if (!d) return []
  const pct = scale(d.days.map(day => day.pazar_fen))
  const best = d.best_days[0]?.business_date
  return d.days.map(day => ({
    ...day,
    height: pct(day.pazar_fen),
    label: String(Number(day.business_date.slice(8, 10))),
    best: day.business_date === best,
  }))
})

/** 1, 5, 10, 15, 20, 25 and the last day — enough to read a month by. */
function showDayLabel(label: string, index: number, count: number): boolean {
  const n = Number(label)
  return n === 1 || n % 5 === 0 || index === count - 1
}

const monthBars = computed(() => {
  const d = data.value
  if (!d) return []
  const pct = scale(d.trend.map(point => point.pazar_fen))
  return d.trend.map(point => ({
    ...point,
    height: pct(point.pazar_fen),
    label: monthShortBs(point.month),
    current: point.month === d.month,
  }))
})

/** Up or down against the month before, in percent; `null` with nothing to compare. */
const change = computed(() => {
  const trend = data.value?.trend
  if (!trend || trend.length < 2) return null
  const now = trend[trend.length - 1]!.pazar_fen
  const before = trend[trend.length - 2]!.pazar_fen
  if (before <= 0) return null
  return Math.round(((now - before) / before) * 100)
})
</script>

<template>
  <div class="a-page">
    <UiPageHead eyebrow="Lokal" title="Analitika" :sub="data ? monthLabelBs(data.month) : ''" :stale="error" />

    <!-- The month -->
    <UiCard quiet>
      <div class="an-month">
        <UiButton small :disabled="!data" aria-label="Prethodni mjesec" @click="goMonth(-1)">
          ‹
        </UiButton>
        <strong class="an-month-label">{{ data ? monthLabelBs(data.month) : '…' }}</strong>
        <UiButton small :disabled="!canGoNext" aria-label="Sljedeći mjesec" @click="goMonth(1)">
          ›
        </UiButton>
      </div>
    </UiCard>

    <p v-if="loading && !data" class="an-muted">Učitavanje…</p>

    <template v-if="data">
      <!-- 9. Pazar and Za predati -->
      <UiCard title="Pazar">
        <div class="an-figures">
          <div class="an-figure">
            <small>Ukupan pazar</small>
            <strong class="num">{{ formatKm(data.pazar_fen) }}</strong>
          </div>
          <div class="an-figure">
            <small>Ukupno za predati</small>
            <strong class="num">{{ formatKm(data.za_predati_fen) }}</strong>
          </div>
        </div>
        <p class="an-muted">
          {{ data.shifts }} {{ smjena(data.shifts) }} ·
          {{ data.closed_shifts }} zaključeno
          <template v-if="change !== null">
            · <span :class="change < 0 ? 'an-down' : 'an-up'">
              {{ change > 0 ? '+' : '' }}{{ change }} % u odnosu na prošli mjesec
            </span>
          </template>
        </p>
      </UiCard>

      <!-- 10. Neto -->
      <UiCard title="Pazar − troškovi">
        <dl class="an-lines">
          <div class="an-row">
            <dt>Ukupan pazar</dt>
            <dd class="num">{{ formatKm(data.pazar_fen) }}</dd>
          </div>
          <div class="an-row">
            <dt>− Neplaćeno</dt>
            <dd class="num">{{ formatKm(data.unpaid_fen) }}</dd>
          </div>
          <div class="an-row">
            <dt>− Ukupni troškovi</dt>
            <dd class="num">{{ formatKm(data.total_cost_fen) }}</dd>
          </div>
          <div class="an-row an-total">
            <dt>Ostaje</dt>
            <dd class="num" :class="{ 'an-bad': data.neto_fen < 0 }">{{ formatKm(data.neto_fen) }}</dd>
          </div>
        </dl>
      </UiCard>

      <!-- Rung up, never paid -->
      <UiCard title="Neplaćeno">
        <p class="an-muted an-lead">
          Ukucano u pazar, ali za to nije ušao novac — računi označeni kao otpis, rashod, policija ili osoblje.
        </p>
        <dl class="an-lines">
          <div v-for="key in UNPAID_KEYS" :key="key" class="an-row">
            <dt>{{ UNPAID_LABELS[key] }}</dt>
            <dd class="num">{{ formatKm(data.unpaid[key]) }}</dd>
          </div>
          <div class="an-row an-total">
            <dt>Ukupno</dt>
            <dd class="num">{{ formatKm(data.unpaid_fen) }}</dd>
          </div>
        </dl>
      </UiCard>

      <!-- 1–5, 7. Troškovi -->
      <UiCard title="Troškovi">
        <ul class="an-costs">
          <li v-for="key in MONTH_COST_KEYS" :key="key" class="an-cost">
            <span class="an-cost-text">
              <strong>{{ MONTH_COST_LABELS[key] }}</strong>
              <small>{{ sourceOf(key) }}</small>
            </span>
            <span class="an-cost-value">
              <span class="num">{{ formatKm(data.costs[key]) }}</span>
              <UiButton v-if="MANUAL.has(key)" small variant="soft" @click="openEdit(key)">
                Uredi
              </UiButton>
            </span>
          </li>
        </ul>
        <dl class="an-lines">
          <div class="an-row an-total">
            <dt>Ukupno</dt>
            <dd class="num">{{ formatKm(data.total_cost_fen) }}</dd>
          </div>
        </dl>
      </UiCard>

      <!-- 8. By day -->
      <UiCard title="Pazar po danima">
        <div class="an-chart" role="img" :aria-label="`Pazar po danima, ${monthLabelBs(data.month)}`">
          <div v-for="(bar, index) in dayBars" :key="bar.business_date" class="an-col">
            <div class="an-bar-wrap">
              <div
                class="an-bar"
                :class="{ 'an-bar-best': bar.best }"
                :style="{ height: `${bar.height}%` }"
                :title="`${shortDateBs(bar.business_date)} · ${formatKm(bar.pazar_fen)}`"
              />
            </div>
            <small class="an-tick">{{ showDayLabel(bar.label, index, dayBars.length) ? bar.label : '' }}</small>
          </div>
        </div>
      </UiCard>

      <!-- 8. By month -->
      <UiCard title="Zadnjih 12 mjeseci">
        <div class="an-chart an-chart-months" role="img" aria-label="Pazar po mjesecima">
          <div v-for="bar in monthBars" :key="bar.month" class="an-col">
            <div class="an-bar-wrap">
              <div
                class="an-bar"
                :class="{ 'an-bar-best': bar.current }"
                :style="{ height: `${bar.height}%` }"
                :title="`${monthLabelBs(bar.month)} · ${formatKm(bar.pazar_fen)}`"
              />
            </div>
            <small class="an-tick">{{ bar.label }}</small>
          </div>
        </div>
      </UiCard>

      <!-- 6. Best days -->
      <UiCard title="Najbolji dani">
        <ol v-if="data.best_days.length" class="an-best">
          <li v-for="(day, index) in data.best_days" :key="day.business_date" class="an-row">
            <span>
              <span class="an-rank num">{{ index + 1 }}.</span>
              {{ weekdayBs(day.business_date) }}, {{ shortDateBs(day.business_date) }}
            </span>
            <strong class="num">{{ formatKm(day.pazar_fen) }}</strong>
          </li>
        </ol>
        <p v-else class="an-muted">Ovaj mjesec još nema pazara.</p>
      </UiCard>

      <!-- 11–12. Records per shift -->
      <UiCard title="Rekordi smjena">
        <p v-if="data.records.length === 0" class="an-muted">
          Nema šablona smjena, pa se ne zna koja je prva a koja druga.
        </p>
        <dl v-for="slot in data.records" :key="slot.template_id" class="an-record">
          <strong>{{ slot.name }}</strong>
          <div class="an-row">
            <dt>Ovaj mjesec</dt>
            <dd v-if="slot.month" class="num">
              {{ formatKm(slot.month.pazar_fen) }}
              <small>· {{ shortDateBs(slot.month.business_date) }}</small>
            </dd>
            <dd v-else class="an-muted">—</dd>
          </div>
          <div class="an-row">
            <dt>Svih vremena</dt>
            <dd v-if="slot.all_time" class="num">
              {{ formatKm(slot.all_time.pazar_fen) }}
              <small>· {{ shortDateBs(slot.all_time.business_date) }}{{ slot.all_time.business_date.slice(0, 4) }}.</small>
            </dd>
            <dd v-else class="an-muted">—</dd>
          </div>
        </dl>
      </UiCard>
    </template>

    <UiSheet
      :open="editing !== null"
      :title="editTitle"
      action="Sačuvaj"
      :pending="saving"
      @close="editing = null"
      @confirm="saveEdit"
    >
      <UiField
        v-model="editFen"
        kind="money"
        label="Iznos (KM)"
        placeholder="0,00"
        :error="saveError"
        :hint="editing === 'kirija' ? 'Kirija se prenosi u svaki sljedeći mjesec dok je ne promijeniš.' : undefined"
      />
    </UiSheet>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

.an-muted { margin: 0; color: var(--muted); font-size: var(--text-label); }
.an-lead { margin-bottom: 8px; }

.an-month { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.an-month-label { font-size: var(--text-body); }

.an-figures { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 8px; }
.an-figure { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.an-figure small { color: var(--muted); font-size: var(--text-label); }
.an-figure strong { font-size: 1.5rem; line-height: 1.2; color: var(--ink); overflow-wrap: anywhere; }

.an-up { color: var(--good); }
.an-down { color: var(--danger); }

.an-lines { margin: 0; display: flex; flex-direction: column; gap: 6px; }
.an-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.an-row dt { color: var(--ink-2); }
.an-row dd { margin: 0; text-align: right; }
.an-row dd small { color: var(--muted); font-weight: 400; }
.an-total {
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
  font-weight: 700;
}
.an-total dt { color: var(--ink); }
.an-bad { color: var(--danger); }

.an-costs { list-style: none; margin: 0; padding: 0; }
.an-cost {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 52px;
  padding: 6px 0;
  border-bottom: 1px solid var(--line-soft);
}
.an-cost-text { display: flex; flex-direction: column; min-width: 0; }
.an-cost-text small { color: var(--muted); font-size: var(--text-label); }
.an-cost-value { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

.an-chart {
  display: flex;
  align-items: stretch;
  gap: 2px;
  height: 160px;
}
.an-chart-months { gap: 6px; }
.an-col { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; }
.an-bar-wrap { flex: 1; display: flex; align-items: flex-end; }
.an-bar {
  width: 100%;
  border-radius: 3px 3px 0 0;
  background: var(--accent-line);
}
.an-bar-best { background: var(--accent); }
.an-tick {
  height: 16px;
  margin-top: 4px;
  font-size: 0.6875rem;
  line-height: 16px;
  color: var(--muted);
  text-align: center;
  white-space: nowrap;
}

.an-best { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.an-rank { display: inline-block; min-width: 1.5em; color: var(--muted); }

.an-record { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 8px 0; }
.an-record + .an-record { border-top: 1px solid var(--line-soft); }
</style>
