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
import { cutoffIso, nextBusinessDate } from '#shared/dates'
import type { DeliveryView, ShiftClosing, StockItemAdmin } from '#shared/types'

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
    const end = new Date(Date.parse(cutoffIso(nextBusinessDate(props.businessDate))) - 1)
    const [list, stock] = await Promise.all([
      api.getDeliveries({ from: cutoffIso(props.businessDate), to: end.toISOString() }),
      items.value.length ? Promise.resolve(items.value) : api.getStockItems(),
    ])
    deliveries.value = list.filter(delivery => !delivery.reversed_at)
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

/** The cost on this shift that pays this invoice, if any. */
function paidCost(deliveryId: string) {
  return props.closing.naknadni.find(cost => cost.delivery_id === deliveryId) ?? null
}

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

async function remove(costId: string, deliveryId: string) {
  if (busy.value) return
  busy.value = deliveryId
  error.value = ''
  try {
    emit('saved', await api.deleteShiftExtraCost(props.shiftId, costId))
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
    <p v-if="loading && deliveries.length === 0" class="n-note">Učitavam fakture…</p>
    <p v-else-if="deliveries.length === 0" class="n-empty">Za ovaj dan nema faktura u prijemu robe.</p>

    <ul v-else class="n-list">
      <li
        v-for="delivery in deliveries"
        :key="delivery.id"
        class="n-doc"
        :class="{ paid: paidCost(delivery.id) }"
      >
        <div class="n-head">
          <span class="n-date num">{{ dateBs(delivery.delivered_at) }}</span>
          <span class="n-cats">{{ categories(delivery) }}</span>
          <strong class="n-total num">{{ formatKm(delivery.total_fen) }}</strong>
        </div>
        <ul class="n-lines">
          <li v-for="(line, i) in delivery.lines" :key="i" class="n-line">
            <span>{{ line.item_name }}</span>
            <span class="n-qty num">{{ formatQty(line.qty, itemById.get(line.stock_item_id)?.base_unit) }}</span>
          </li>
        </ul>
        <div class="n-act">
          <template v-if="paidCost(delivery.id)">
            <span class="n-paid">✓ Plaćeno iz ove smjene</span>
            <UiButton
              small variant="ghost" :disabled="busy !== null"
              @click="remove(paidCost(delivery.id)!.id, delivery.id)"
            >
              Ukloni
            </UiButton>
          </template>
          <UiButton
            v-else small variant="primary" :pending="busy === delivery.id" :disabled="busy !== null"
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
.n-doc.paid { border-color: var(--accent-line); }
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
.n-paid { margin-right: auto; font-size: var(--text-label); font-weight: 600; color: var(--accent-ink); }
.n-sum { margin: 0; color: var(--ink-2); font-size: var(--text-label); }
</style>
