<script setup lang="ts">
/**
 * One *popis*, line by line, and the *Primijeni* button that applies it.
 *
 * **Confirming is the only thing that moves stock.** The adjustment is
 * recomputed at confirm time, not read off the submitted line: rounds that
 * synced in between are already on the shelf, so the difference between what
 * was claimed and what is written is shown per line as *kasno stiglo*.
 */
import type { ConfirmResult, CountLineView, CountView } from '#shared/types'
import type { UiColumn } from '~/components/ui/UiTable.vue'

definePageMeta({ middleware: 'admin', layout: 'admin' })

const route = useRoute()
const api = useAdminApi()

const countId = computed(() => String(route.params.id ?? ''))

const count = ref<CountView | null>(null)
const loading = ref(true)
const error = ref('')
const confirming = ref(false)
const confirmError = ref('')
const override = ref(false)
const applied = ref<ConfirmResult | null>(null)
/** Item ids the confirm refused on — `PRICE_MISSING` names them. */
const flagged = ref<string[]>([])

useHead({ title: 'Roba — popis' })

async function load() {
  try {
    count.value = await api.getCount(countId.value)
    error.value = ''
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

useAdminChanges({
  onEntity: (entity) => { if (entity === 'count') void load() },
})

onMounted(() => { void load() })

async function confirm() {
  if (confirming.value) return
  confirming.value = true
  confirmError.value = ''
  flagged.value = []
  try {
    applied.value = await api.confirmCount(countId.value, {
      override: override.value || undefined,
    })
    count.value = applied.value.count
  } catch (err) {
    confirmError.value = apiErrorText(err)
    const ids = (err as { data?: Record<string, unknown> })?.data?.item_ids
    if (Array.isArray(ids)) flagged.value = ids.map(String)
  } finally {
    confirming.value = false
  }
}

const COLUMNS: UiColumn[] = [
  { key: 'name', label: 'Artikal' },
  { key: 'counted', label: 'Popisano', align: 'r' },
  { key: 'theoretical', label: 'Po ledgeru', align: 'r' },
  { key: 'variance', label: 'Razlika', align: 'r' },
  { key: 'value', label: 'Vrijednost', align: 'r' },
  { key: 'applied', label: 'Provedeno', align: 'r' },
  { key: 'note', label: 'Napomena' },
]

/** The row's background: green inside tolerance, amber outside, red when refused. */
function lineClass(line: CountLineView): string {
  if (flagged.value.includes(line.stock_item_id)) return 'line-bad'
  if (line.out_of_tolerance) return 'line-warn'
  return line.variance_qty === 0 ? '' : 'line-ok'
}

/** A difference of nothing is "0", not "+0" — the plus sign implies a change. */
function deltaText(value: number, unit: CountLineView['base_unit']): string {
  return value === 0 ? '0' : formatMovementQty(value, unit)
}

/** How much of the variance was explained by rounds that synced late. */
function lateDelta(itemId: string): number | null {
  const row = applied.value?.lines.find(line => line.stock_item_id === itemId)
  return row && row.late_delta !== 0 ? row.late_delta : null
}

const KIND_LABELS: Record<CountView['kind'], string> = { spot: 'spot popis', full: 'puni popis' }
const PHASE_LABELS: Record<CountView['phase'], string> = {
  open: 'otvaranje smjene', close: 'zatvaranje smjene', adhoc: 'vanredni',
}
</script>

<template>
  <div class="a-page">
    <RobaTabs :sub="count ? `${KIND_LABELS[count.kind]} · ${PHASE_LABELS[count.phase]}` : 'popis'">
      <template #actions>
        <UiButton variant="ghost" @click="navigateTo('/admin/roba/popisi')">Svi popisi</UiButton>
      </template>
    </RobaTabs>

    <p v-if="error" class="a-error">{{ error }}</p>

    <div v-if="count" class="a-tiles">
      <UiTile label="Popisao" :value="count.counted_by_name" :sub="dateTimeBs(count.submitted_at)" />
      <UiTile label="Stavki" :value="count.totals.lines" :sub="`${count.totals.out_of_tolerance} van tolerancije`" />
      <UiTile
        label="Manjak / višak"
        :value="signedKm(count.totals.variance_fen)"
        :tone="count.totals.variance_fen < 0 ? 'bad' : count.totals.variance_fen > 0 ? 'warn' : 'plain'"
        sub="po nabavnoj cijeni"
      />
      <UiTile
        label="Status"
        :value="count.status === 'confirmed' ? 'potvrđeno' : 'čeka potvrdu'"
        :tone="count.status === 'confirmed' ? 'good' : 'warn'"
        :sub="count.confirmed_by_name ? `${count.confirmed_by_name} · ${dateTimeBs(count.confirmed_at)}` : 'ledger se još nije pomjerio'"
      />
    </div>

    <UiCard v-if="count" title="Stavke" :count="`${count.lines.length}`">
      <template #actions>
        <UiButton
          v-if="count.status === 'submitted'"
          variant="primary"
          :pending="confirming"
          @click="confirm"
        >Primijeni</UiButton>
      </template>

      <p v-if="count.note" class="a-muted">Napomena: {{ count.note }}</p>

      <div v-if="count.stale_devices.length > 0" class="a-stale">
        <p>
          Telefoni koji još drže neposlane ture, a odavno se nisu javili — popis je
          poslan preko njih:
        </p>
        <ul>
          <li v-for="device in count.stale_devices" :key="device.device_id">
            {{ device.label }} · {{ device.pending_count }} neposlano ·
            {{ device.last_seen_at ? dateTimeBs(device.last_seen_at) : 'nikad se nije javio' }}
          </li>
        </ul>
      </div>

      <UiTable :columns="COLUMNS">
        <tr v-for="line in count.lines" :key="line.id" :class="lineClass(line)">
          <td>
            {{ line.item_name }}
            <small v-if="line.estimated" class="a-est">procijenjena cijena</small>
          </td>
          <td class="r">{{ formatStockQty(line.counted_qty, line.base_unit) }}</td>
          <td class="r">{{ formatStockQty(line.theoretical_qty, line.base_unit) }}</td>
          <td class="r" :class="{ 'a-zero': line.variance_qty === 0 }">
            {{ deltaText(line.variance_qty, line.base_unit) }}
          </td>
          <td class="r"><UiMoney :fen="line.variance_fen" :currency="false" /></td>
          <td class="r">
            <template v-if="line.applied_adjust !== null">
              {{ deltaText(line.applied_adjust, line.base_unit) }}
              <small v-if="lateDelta(line.stock_item_id) !== null" class="a-est">
                kasno stiglo {{ formatMovementQty(lateDelta(line.stock_item_id)!, line.base_unit) }}
              </small>
            </template>
            <span v-else class="a-muted">—</span>
          </td>
          <td>{{ line.note ?? '' }}</td>
        </tr>
      </UiTable>

      <label v-if="count.status === 'submitted'" class="a-override">
        <input v-model="override" type="checkbox">
        <span>Ipak potvrdi, i kad telefon još drži neposlane ture</span>
      </label>

      <p v-if="confirmError" class="a-error">{{ confirmError }}</p>
      <p v-if="applied" class="a-ok">
        Popis je proveden — stanje na polici je pomjereno za
        {{ applied.lines.length }} stavki.
      </p>
    </UiCard>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.a-error { margin: 0; color: var(--danger); font-size: var(--text-label); }
.a-ok { margin: 0; color: var(--good); font-size: var(--text-label); }
.a-muted { margin: 0; color: var(--muted); font-size: var(--text-micro); }

.a-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }

.a-est { display: block; font-size: var(--text-caption); color: var(--muted); }
.a-zero { color: var(--muted); }

/* The three line colours from the kit. The word is always in the row too. */
.line-ok :deep(td) { background: var(--good-soft); }
.line-warn :deep(td) { background: var(--warn-soft); }
.line-bad :deep(td) { background: var(--danger-soft); }

.a-stale {
  background: var(--warn-soft);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: var(--text-micro);
  color: var(--ink-2);
}

.a-stale p { margin: 0 0 6px; }
.a-stale ul { margin: 0; padding-left: 18px; }

.a-override { display: flex; align-items: center; gap: 8px; font-size: var(--text-micro); color: var(--ink-2); }
.a-override input { width: 18px; height: 18px; }

@media (max-width: 1023px) {
  .a-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .a-override { min-height: 44px; }
}
</style>
