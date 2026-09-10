<script setup lang="ts">
/**
 * One line of a scanned otpremnica, fully editable (PHASE4 WP3).
 *
 * Three shapes, and the colour is never alone — every row carries the **word**
 * as well, because a colour-blind owner and a printed screenshot have to read
 * the same thing:
 *
 * - **prepoznato** (green, confidence ≥ 0,8) — the item, packs + loose, and the
 *   price per pack the model read off the paper;
 * - **nesigurno** (amber, 0,4–0,8) — the same row with the OCR text beside it
 *   and the item field focused, because that is the field to check;
 * - **nepoznato** — no item behind it at all: the OCR text and three ways out,
 *   *Poveži* (learn it, so next time it is green), *Novi artikal* and *Preskoči*.
 *
 * Every price here is a **suggestion the owner edits**. The catalogue does not
 * know what the supplier charged this week, and nothing reaches a movement until
 * *Proknjiži*.
 */
import type { StockItemAdmin } from '#shared/types'
import type { ScanFormLine } from '~/composables/useScan'

const props = defineProps<{
  line: ScanFormLine
  items: StockItemAdmin[]
  /** The whole draft is posting; the row goes read-only rather than jumping. */
  locked?: boolean
  /**
   * The first *nesigurno* row: its article field is the one to check, so it gets
   * the keyboard. `preventScroll` on purpose — the field is focused without the
   * page jumping past the photo, which is the other half of checking a scan.
   */
  focusItem?: boolean
}>()

const emit = defineEmits<{
  /** The owner picked a different article; the draft re-derives packs and loose. */
  pick: [id: string]
  link: []
  create: []
  skip: []
  restore: []
}>()

const options = computed(() => props.items
  .filter(item => item.active)
  .map(item => ({ value: item.id, label: item.name })))

function itemOf(id: string): StockItemAdmin | undefined {
  return props.items.find(item => item.id === id)
}

const item = computed(() => itemOf(props.line.stock_item_id))

const root = ref<HTMLElement | null>(null)

onMounted(() => {
  if (!props.focusItem) return
  root.value?.querySelector('select')?.focus({ preventScroll: true })
})

const TONE = { green: 'good', amber: 'warn', unknown: 'neutral' } as const
const WORD = { green: 'prepoznato', amber: 'nesigurno', unknown: 'nepoznato' } as const

/** packs × pack size + loose, in the item's base unit — the number that is booked. */
const qty = computed(() => {
  const packSize = item.value?.pack_qty ?? 0
  return (props.line.packs ?? 0) * packSize + (props.line.loose ?? 0)
})

const qtyText = computed(() => item.value ? formatStockQty(qty.value, item.value.base_unit) : '')

/** What one unit ends up costing — the number that moves the moving average. */
const unitCostText = computed(() => {
  const cost = props.line.line_cost_fen ?? 0
  if (qty.value <= 0 || cost <= 0) return ''
  return `${formatKm(Math.round(cost / qty.value))} po jedinici`
})
</script>

<template>
  <div ref="root" class="a-line" :class="[`m-${line.match}`, { skipped: line.skipped }]">
    <div class="a-line-head">
      <UiPill :tone="TONE[line.match]">{{ WORD[line.match] }}</UiPill>
      <span v-if="line.from_alias" class="a-src">povezano ranije</span>
      <span class="a-ocr">{{ line.text }}</span>
      <span v-if="line.skipped" class="a-skipped">preskočeno</span>
    </div>

    <template v-if="!line.skipped">
      <div v-if="line.match === 'unknown' && !line.stock_item_id" class="a-unknown">
        <p class="a-muted">
          Ovaj red nije prepoznat. Poveži ga s artiklom, otvori novi ili ga preskoči.
        </p>
        <div class="a-unknown-acts">
          <UiButton variant="soft" :disabled="locked" @click="emit('link')">Poveži</UiButton>
          <UiButton variant="soft" :disabled="locked" @click="emit('create')">Novi artikal</UiButton>
          <UiButton variant="ghost" :disabled="locked" @click="emit('skip')">Preskoči</UiButton>
        </div>
      </div>

      <template v-else>
        <div class="a-line-grid">
          <UiField
            :model-value="line.stock_item_id"
            label="Roba"
            kind="select"
            :options="options"
            :disabled="locked"
            @update:model-value="emit('pick', String($event ?? ''))"
          />
          <UiField
            v-model="line.packs"
            label="Paketi"
            kind="decimal"
            :disabled="locked || !item?.pack_qty"
            :hint="item?.pack_qty ? `${item.pack_name} × ${item.pack_qty}` : 'nema paketa'"
          />
          <UiField v-model="line.loose" label="Komadi" kind="decimal" :disabled="locked" />
          <UiField
            v-model="line.line_cost_fen"
            label="Cijena stavke (KM)"
            kind="money"
            :disabled="locked"
            :hint="unitCostText"
          />
        </div>

        <div class="a-line-foot">
          <span class="a-line-qty">Ukupno: {{ qtyText }}</span>
          <UiButton small variant="ghost" :disabled="locked" @click="emit('skip')">Preskoči</UiButton>
        </div>
      </template>
    </template>

    <div v-else class="a-line-foot">
      <span class="a-line-qty">Ovaj red se ne knjiži.</span>
      <UiButton small variant="ghost" :disabled="locked" @click="emit('restore')">Vrati</UiButton>
    </div>
  </div>
</template>

<style scoped>
.a-line {
  border: 1px solid var(--line);
  border-left-width: 4px;
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--bg);
}

.m-green { border-left-color: var(--good); }
.m-amber { border-left-color: var(--warn); }
.m-unknown { border-left-color: var(--line); }
.skipped { opacity: 0.6; }

.a-line-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.a-ocr { font-size: 13px; color: var(--muted); min-width: 0; overflow-wrap: anywhere; }
.a-src, .a-skipped { font-size: 12px; font-weight: 600; color: var(--muted); }

.a-unknown { display: flex; flex-direction: column; gap: 10px; }
.a-unknown-acts { display: flex; gap: 8px; flex-wrap: wrap; }

.a-line-grid { display: grid; grid-template-columns: 2fr 1fr 1fr 1.2fr; gap: 12px; }
.a-line-foot { display: flex; align-items: center; gap: 12px; }
.a-line-qty { font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
.a-line-foot .a-btn { margin-left: auto; }
.a-muted { margin: 0; color: var(--muted); font-size: 13px; }

@media (max-width: 1023px) {
  .a-line-grid { grid-template-columns: 1fr 1fr; }
  /* A truncated article name is useless — the select spans the row. */
  .a-line-grid > :first-child { grid-column: 1 / -1; }
  .a-unknown-acts > .a-btn { flex-grow: 1; }
}
</style>
