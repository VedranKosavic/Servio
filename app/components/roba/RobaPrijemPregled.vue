<script setup lang="ts">
/**
 * *Pregled narudžbi* — under the document on *Prijem robe* (the owner's call,
 * 17.09.2026): when goods were ordered, what came, and what it cost.
 *
 * The last 90 days, newest first, every article on its own line. A reversed
 * document stays in the list, struck through, so the page never silently loses
 * a delivery somebody remembers booking. The full archive with its period chips
 * and *Storniraj* is still *Historija*.
 */
import { formatKm, formatQty } from '#shared/money'
import type { DeliveryView, StockItemAdmin } from '#shared/types'

const props = defineProps<{ items: StockItemAdmin[] }>()

const api = useAdminApi()

const deliveries = ref<DeliveryView[]>([])
const loading = ref(true)
const error = ref('')

async function load() {
  try {
    const from = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString()
    deliveries.value = await api.getDeliveries({ from, to: new Date(Date.now() + 24 * 3600 * 1000).toISOString() })
    error.value = ''
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

onMounted(() => { void load() })
useAdminChanges({
  onEntity: (entity) => { if (entity === 'stock') void load() },
})
defineExpose({ load })

const unitOf = computed(() => new Map(props.items.map(item => [item.id, item.base_unit])))
const categoryOf = computed(() => new Map(props.items.map(item => [item.id, item.category_name])))

/** Beside the date: which categories the goods came from, "Pića · Nargila". */
function categories(delivery: DeliveryView): string {
  const names = new Set<string>()
  for (const line of delivery.lines) names.add(categoryOf.value.get(line.stock_item_id) || 'Bez kategorije')
  return [...names].join(' · ')
}

const total = computed(() => deliveries.value
  .filter(delivery => !delivery.reversed_at)
  .reduce((sum, delivery) => sum + delivery.total_fen, 0))
</script>

<template>
  <UiCard title="Pregled narudžbi" :count="`zadnjih 90 dana · ${formatKm(total)}`">
    <p v-if="error" class="p-error">{{ error }}</p>
    <p v-else-if="loading" class="p-empty">Učitavam…</p>
    <p v-else-if="deliveries.length === 0" class="p-empty">Još nema proknjiženih prijema.</p>

    <ul v-else class="p-list">
      <li
        v-for="delivery in deliveries"
        :key="delivery.id"
        class="p-doc"
        :class="{ reversed: delivery.reversed_at, paid: delivery.paid_from_shift_id && !delivery.reversed_at }"
      >
        <div class="p-head">
          <span class="p-date num">{{ dateBs(delivery.delivered_at) }}</span>
          <span class="p-cats">{{ categories(delivery) }}</span>
          <span class="p-who">{{ delivery.entered_by_name }}</span>
          <UiPill v-if="delivery.reversed_at" tone="bad">stornirano</UiPill>
          <!-- Paid out of a shift as a naknadni trošak. -->
          <UiPill v-else-if="delivery.paid_from_shift_id" tone="good">plaćeno</UiPill>
          <strong class="p-total num">{{ formatKm(delivery.total_fen) }}</strong>
        </div>
        <ul class="p-lines">
          <li v-for="(line, i) in delivery.lines" :key="i" class="p-line">
            <span class="p-name">{{ line.item_name }}</span>
            <span class="p-qty num">{{ formatQty(line.qty, unitOf.get(line.stock_item_id)) }}</span>
            <span class="p-cost num">{{ formatKm(line.line_cost_fen) }}</span>
          </li>
        </ul>
      </li>
    </ul>
  </UiCard>
</template>

<style scoped>
.p-error { margin: 0; color: var(--danger); font-size: var(--text-label); }
.p-empty { margin: 0; color: var(--muted); font-size: var(--text-label); }
.p-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.p-doc {
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--surface);
  overflow: hidden;
}
.p-head {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 14px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--line-soft);
}
.p-date { font-weight: 700; color: var(--ink); }
.p-cats { font-size: var(--text-label); font-weight: 600; color: var(--accent-ink); }
.p-who { font-size: var(--text-label); color: var(--muted); }
.p-total { margin-left: auto; color: var(--ink); }
.p-lines { list-style: none; margin: 0; padding: 0; }
.p-line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 12px;
  align-items: center;
  padding: 8px 14px;
  border-bottom: 1px solid var(--line-soft);
  font-size: var(--text-label);
}
.p-line:last-child { border-bottom: 0; }
.p-name { min-width: 0; overflow-wrap: anywhere; color: var(--ink); }
.p-qty { color: var(--muted); white-space: nowrap; }
.p-cost { white-space: nowrap; min-width: 80px; text-align: right; }
.paid { border-color: var(--good); }
.paid .p-head { background: var(--good-soft); border-bottom-color: var(--good); }
.paid .p-total { color: var(--good); }
.reversed .p-lines, .reversed .p-total { text-decoration: line-through; opacity: 0.6; }
</style>
