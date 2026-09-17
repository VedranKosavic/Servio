<script setup lang="ts">
/**
 * *Naknadni troškovi* — a *Prijem robe* invoice paid out of this shift's
 * takings after the šanker closed it (the owner, 17.09.2026). Admins only.
 *
 * The sheet lists the invoices of **the shift's business day** only. *Plati*
 * sends the invoice's id and nothing else: the server reads the amount off the
 * invoice, checks the day, and refuses an invoice already paid from a shift.
 * The answer is the shift's closing again, so *Kasa* and *Predano* redraw from
 * the server's number.
 */
import { formatKm, formatQty } from '#shared/money'
import { addDays, calendarDay, cutoffIso } from '#shared/dates'
import { shiftCostText } from '#shared/shiftCosts'
import type { DeliveryView, ShiftClosing, StockItemAdmin } from '#shared/types'
import { isLogistika } from '~/utils/stockCost'

const props = defineProps<{
  open: boolean
  shiftId: string
  /** `YYYY-MM-DD` — the day whose invoices are offered. */
  businessDate: string
  closing: ShiftClosing
}>()

const emit = defineEmits<{ close: [], saved: [closing: ShiftClosing] }>()

const api = useAdminApi()

const deliveries = ref<DeliveryView[]>([])
const items = ref<StockItemAdmin[]>([])
const loading = ref(false)
const busy = ref<string | null>(null)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    // A day either side, then filtered by the date printed on the invoice.
    const [list, stock] = await Promise.all([
      api.getDeliveries({ from: cutoffIso(addDays(props.businessDate, -1)), to: cutoffIso(addDays(props.businessDate, 2)) }),
      items.value.length ? Promise.resolve(items.value) : api.getStockItems(),
    ])
    deliveries.value = list.filter(delivery =>
      !delivery.reversed_at && calendarDay(delivery.delivered_at) === props.businessDate)
    items.value = stock
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

watch(() => props.open, (open) => { if (open) void load() })

const itemById = computed(() => new Map(items.value.map(item => [item.id, item])))

/** "Pića · Nargila" — which categories the invoice's goods came from. */
function categories(delivery: DeliveryView): string {
  const names = new Set<string>()
  for (const line of delivery.lines) names.add(itemById.value.get(line.stock_item_id)?.category_name || 'Bez kategorije')
  return [...names].join(' · ')
}

/**
 * The invoices still to pay: one already paid — from this shift or any other —
 * is not offered again. This shift's own are listed above with *Ukloni*.
 */
const available = computed(() => {
  const paidHere = new Set(props.closing.naknadni.map(cost => cost.delivery_id))
  return deliveries.value.filter(delivery => !delivery.paid_from_shift_id && !paidHere.has(delivery.id))
})

async function pay(delivery: DeliveryView) {
  if (busy.value) return
  busy.value = delivery.id
  error.value = ''
  try {
    emit('saved', await api.addShiftExtraCost(props.shiftId, {
      client_id: crypto.randomUUID(),
      delivery_id: delivery.id,
    }))
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    busy.value = null
  }
}

async function remove(costId: string) {
  if (busy.value) return
  busy.value = costId
  error.value = ''
  try {
    emit('saved', await api.deleteShiftExtraCost(props.shiftId, costId))
    // The invoice is free again: read the day's list so it is offered back.
    await load()
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <UiSheet :open="open" title="Naknadni troškovi" @close="emit('close')">
    <p class="n-note">
      Izaberi fakturu iz prijema robe za {{ dateBs(businessDate) }} koja je plaćena iz pazara ove smjene.
    </p>

    <p v-if="error" class="n-error">{{ error }}</p>

    <!-- Already paid from this shift: shown once, here, never offered again. -->
    <ul v-if="closing.naknadni.length" class="n-paid-list">
      <li v-for="cost in closing.naknadni" :key="cost.id" class="n-paid-row">
        <span class="n-paid">✓ {{ shiftCostText(cost) }}</span>
        <span class="num">{{ formatKm(cost.amount_fen) }}</span>
        <UiButton small variant="ghost" :pending="busy === cost.id" :disabled="busy !== null" @click="remove(cost.id)">
          Ukloni
        </UiButton>
      </li>
    </ul>

    <p v-if="loading && deliveries.length === 0" class="n-note">Učitavam fakture…</p>
    <p v-else-if="available.length === 0" class="n-empty">Nema neplaćenih faktura za ovaj dan.</p>

    <ul v-else class="n-list">
      <li v-for="delivery in available" :key="delivery.id" class="n-doc">
        <div class="n-head">
          <span class="n-date num">{{ dateBs(delivery.delivered_at) }}</span>
          <span class="n-cats">{{ categories(delivery) }}</span>
          <strong class="n-total num">{{ formatKm(delivery.total_fen) }}</strong>
        </div>
        <ul class="n-lines">
          <li v-for="(line, i) in delivery.lines" :key="i" class="n-line">
            <span>{{ line.item_name }}</span>
            <span class="n-qty num">{{ isLogistika(itemById.get(line.stock_item_id)?.category_name) ? '' : formatQty(line.qty, itemById.get(line.stock_item_id)?.base_unit) }}</span>
          </li>
        </ul>
        <div class="n-act">
          <UiButton
            small variant="primary" :pending="busy === delivery.id" :disabled="busy !== null"
            @click="pay(delivery)"
          >
            Plati iz smjene
          </UiButton>
        </div>
      </li>
    </ul>

    <p class="n-sum">
      Za predati: <strong class="num">{{ formatKm(closing.za_predati_fen) }}</strong>
      <template v-if="closing.naknadni_fen > 0">
        (šanker predao {{ formatKm(closing.za_predati_at_close_fen) }})
      </template>
    </p>

    <template #footer>
      <UiButton variant="primary" @click="emit('close')">Gotovo</UiButton>
    </template>
  </UiSheet>
</template>

<style scoped>
.n-note { margin: 0; color: var(--muted); font-size: var(--text-label); }
.n-empty { margin: 0; color: var(--ink-2); font-size: var(--text-label); }
.n-error { margin: 0; color: var(--danger); font-size: var(--text-label); }
.n-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.n-doc { border: 1px solid var(--line); border-radius: var(--radius-card); overflow: hidden; }
.n-paid-list { list-style: none; margin: 0; padding: 0; }
.n-paid-row {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 0; border-bottom: 1px solid var(--line-soft); font-size: var(--text-label);
}
.n-head {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 14px; background: var(--surface-2); border-bottom: 1px solid var(--line-soft);
}
.n-date { font-weight: 700; color: var(--ink); }
.n-cats { font-size: var(--text-label); font-weight: 600; color: var(--accent-ink); }
.n-total { margin-left: auto; color: var(--ink); }
.n-lines { list-style: none; margin: 0; padding: 6px 14px; }
.n-line {
  display: flex; justify-content: space-between; gap: 12px;
  padding: 3px 0; font-size: var(--text-label); color: var(--ink);
}
.n-qty { color: var(--muted); white-space: nowrap; }
.n-act {
  display: flex; align-items: center; justify-content: flex-end; gap: 10px;
  padding: 8px 14px; border-top: 1px solid var(--line-soft);
}
.n-paid { margin-right: auto; min-width: 0; font-size: var(--text-label); font-weight: 600; color: var(--accent-ink); }
.n-sum { margin: 0; color: var(--ink-2); font-size: var(--text-label); }
</style>
