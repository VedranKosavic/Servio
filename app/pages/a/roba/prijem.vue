<script setup lang="ts">
/**
 * *Prijem robe* — book a delivery note, and see the ones already booked.
 *
 * Two ways in, one ledger. **Ručno** is the typed otpremnica and stays the
 * fallback; **Sa slike** (PHASE4 WP3) photographs the paper, hands it to the
 * model, and produces a *draft* the owner edits — which then posts through the
 * very same `POST /api/stock/deliveries`, with `source: 'scan'` and the
 * `scan_id`. Nothing about movements, the moving average or storno changes.
 *
 * A delivery is never deleted. A mistake is **reversed**: the reversal writes
 * the opposite movements and leaves both documents in the ledger, so the
 * evening's paper trail still adds up a year from now.
 */
import { cutoffIso, nextBusinessDate } from '#shared/dates'
import type { DeliveryView, StockItemAdmin } from '#shared/types'
import type { UiColumn } from '~/components/ui/UiTable.vue'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Roba — prijem robe' })

const api = useAdminApi()
const route = useRoute()

/**
 * `UiPeriod` builds its own `useAdminPeriod()` on the default fallback, so a
 * page that asked for a different one here would light up one chip and read a
 * different range. The default is kept and the wanted preset is written into
 * the URL instead — then both instances read the same answer.
 */
const period = useAdminPeriod()
if (!route.query.period && !route.query.from) period.setPeriod('ovaj-mjesec')

/**
 * `GET /api/stock/deliveries` compares `from` / `to` against `deliveries.
 * delivered_at`, which is a UTC **instant**, so a business day has to be handed
 * over as one: 06:00 local on the first day, to 06:00 local on the day after the
 * last. Sending the bare date would drop every delivery booked after midnight
 * on the closing day.
 */
function instantRange(): { from: string, to: string } {
  const { from, to } = period.range.value
  const end = new Date(Date.parse(cutoffIso(nextBusinessDate(to))) - 1)
  return { from: cutoffIso(from), to: end.toISOString() }
}

/**
 * Which way in. *Ručno* is the default because it is the one that always works;
 * *Sa slike* is one tap away and the segment remembers nothing between visits —
 * a delivery is a decision, not a preference.
 */
const mode = ref<'rucno' | 'slika'>('rucno')

const MODES = [
  { value: 'rucno', label: 'Ručno' },
  { value: 'slika', label: 'Sa slike' },
]

/**
 * Set when `POST /api/stock/deliveries/scan` answered `503 SCAN_NOT_CONFIGURED`.
 * The venue has no key; the typed form opens beneath the calm card and the page
 * does not ask again.
 */
const scanOff = ref(false)

const items = ref<StockItemAdmin[]>([])
const deliveries = ref<DeliveryView[]>([])
const loading = ref(true)
const error = ref('')

async function loadCatalogue() {
  try {
    items.value = await api.getStockItems()
  } catch (err) {
    error.value = apiErrorText(err)
  }
}

async function loadDeliveries() {
  loading.value = true
  try {
    deliveries.value = await api.getDeliveries(instantRange())
    error.value = ''
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

useAdminChanges({
  onEntity: (entity) => { if (entity === 'stock') void loadDeliveries() },
})

onMounted(() => {
  void loadCatalogue()
  void loadDeliveries()
})

watch(() => period.range.value, () => { void loadDeliveries() })

const COLUMNS: UiColumn[] = [
  { key: 'date', label: 'Datum' },
  { key: 'supplier', label: 'Dobavljač' },
  { key: 'invoice', label: 'Otpremnica' },
  { key: 'lines', label: 'Stavke', align: 'r' },
  { key: 'total', label: 'Ukupno', align: 'r' },
  { key: 'who', label: 'Unio' },
  { key: 'status', label: 'Status' },
  { key: 'act', label: '' },
]

/** The expanded row, so the owner can read the lines before he reverses one. */
const openId = ref<string | null>(null)

function toggle(id: string) {
  openId.value = openId.value === id ? null : id
}

// -- Storniranje -------------------------------------------------------------

const reversing = ref<DeliveryView | null>(null)
const reverseNote = ref('')
const reverseError = ref('')
const sending = ref(false)

function askReverse(delivery: DeliveryView) {
  reversing.value = delivery
  reverseNote.value = ''
  reverseError.value = ''
}

async function confirmReverse() {
  const target = reversing.value
  if (!target || reverseNote.value.trim().length < 3 || sending.value) return
  sending.value = true
  reverseError.value = ''
  try {
    await api.reverseDelivery(target.id, { note: reverseNote.value.trim() })
    reversing.value = null
    await loadDeliveries()
  } catch (err) {
    reverseError.value = apiErrorText(err)
  } finally {
    sending.value = false
  }
}

const total = computed(() => deliveries.value
  .filter(delivery => !delivery.reversed_at)
  .reduce((sum, delivery) => sum + delivery.total_fen, 0))
</script>

<template>
  <div class="a-page">
    <RobaTabs sub="prijem robe · fakture i otpremnice" />

    <p v-if="error" class="a-error">{{ error }}</p>

    <UiSeg v-model="mode" :options="MODES" label="Način prijema" />

    <RobaScanCard
      v-if="mode === 'slika'"
      :items="items"
      @posted="loadDeliveries"
      @catalogue="loadCatalogue"
      @fallback="scanOff = true"
    />

    <RobaPrijemForm
      v-if="mode === 'rucno' || scanOff"
      :items="items"
      @posted="loadDeliveries"
    />

    <UiCard title="Proknjiženi prijemi" :count="`${deliveries.length} · ${formatKm(total)}`">
      <template #actions>
        <span class="a-muted">{{ period.label.value }}</span>
      </template>

      <UiPeriod />

      <UiTable :columns="COLUMNS" :loading="loading">
        <template v-for="delivery in deliveries" :key="delivery.id">
          <tr>
            <td class="a-nowrap">{{ dateBs(delivery.delivered_at) }}</td>
            <td>{{ delivery.supplier_name }}</td>
            <td>{{ delivery.invoice_no ?? '—' }}</td>
            <td class="r">{{ delivery.lines.length }}</td>
            <td class="r"><UiMoney :fen="delivery.total_fen" :currency="false" /></td>
            <td>{{ delivery.entered_by_name }}</td>
            <td>
              <UiPill :tone="delivery.reversed_at ? 'bad' : 'good'">
                {{ delivery.reversed_at ? 'stornirano' : 'proknjiženo' }}
              </UiPill>
            </td>
            <td class="a-acts">
              <UiButton small variant="ghost" @click="toggle(delivery.id)">
                {{ openId === delivery.id ? 'Sakrij' : 'Stavke' }}
              </UiButton>
              <UiButton
                v-if="!delivery.reversed_at"
                small
                variant="danger"
                @click="askReverse(delivery)"
              >Storniraj</UiButton>
            </td>
          </tr>
          <tr v-if="openId === delivery.id">
            <td colspan="8" class="a-detail">
              <ul class="a-detail-lines">
                <li v-for="line in delivery.lines" :key="line.stock_item_id">
                  <span class="a-detail-name">{{ line.item_name }}</span>
                  <span class="a-muted">{{ line.packs }} paketa + {{ line.loose }} · ukupno {{ line.qty }}</span>
                  <UiMoney :fen="line.line_cost_fen" />
                </li>
              </ul>
              <p v-if="delivery.reversal_note" class="a-muted">
                Storno: {{ delivery.reversal_note }}
              </p>
            </td>
          </tr>
        </template>
      </UiTable>

      <p v-if="!loading && deliveries.length === 0" class="a-empty">
        U ovom periodu nema proknjiženih prijema.
      </p>
    </UiCard>

    <UiSheet
      :open="reversing !== null"
      title="Storniraj prijem"
      :pending="sending"
      @close="reversing = null"
      @confirm="confirmReverse"
    >
      <p class="a-muted">
        Prijem se ne briše — storno upisuje suprotne redove u ledger i oba
        dokumenta ostaju vidljiva. Napiši zašto.
      </p>
      <p v-if="reversing" class="a-muted">
        {{ reversing.supplier_name }} · {{ formatKm(reversing.total_fen) }} ·
        {{ dateBs(reversing.delivered_at) }}
      </p>
      <UiField
        v-model="reverseNote"
        label="Razlog"
        kind="textarea"
        placeholder="Npr. faktura je unesena dva puta"
        :error="reverseError"
      />
      <template #footer>
        <UiButton variant="ghost" @click="reversing = null">Odustani</UiButton>
        <UiButton
          variant="danger"
          :disabled="reverseNote.trim().length < 3"
          :pending="sending"
          @click="confirmReverse"
        >Storniraj</UiButton>
      </template>
    </UiSheet>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.a-error { margin: 0; color: var(--danger); font-size: 14px; }
.a-muted { margin: 0; color: var(--muted); font-size: 13px; }
.a-empty { margin: 0; color: var(--muted); font-size: 14px; }
.a-nowrap { white-space: nowrap; }
.a-acts { display: flex; gap: 6px; justify-content: flex-end; }

.a-detail { background: var(--bg); }
.a-detail-lines { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
.a-detail-lines li { display: flex; align-items: baseline; gap: 12px; font-size: 13px; }
.a-detail-name { font-weight: 600; min-width: 160px; }
.a-detail-lines li :last-child { margin-left: auto; }
</style>
