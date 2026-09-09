<script setup lang="ts">
/**
 * *Prijem robe* — a bottom sheet with one line: what arrived, how much, and
 * what the supplier charged for it.
 *
 * Quantities are typed in the item's base unit (grams for tobacco, pieces for
 * bottles), because that is the unit the ledger stores; a comma is accepted as
 * the decimal separator since that is what a Bosnian keyboard offers.
 *
 * **The price is not optional, and that is the point.** It is what the moving
 * average is built from, and an average built out of zeros quietly turns off
 * every variance, *utrošak* and *otpis* figure the owner reads (BACKEND §3.1).
 * A crate you were not charged for is a *korekcija*, not a delivery.
 *
 * Nothing is posted until *Proknjiži* — a delivery is a ledger row and ledger
 * rows are append-only: a mistake here is corrected by another row, never by an
 * edit (PLAN.md §9).
 */
import { parseKm } from '#shared/money'
import type { StockItem } from '#shared/types'

const props = defineProps<{
  items: StockItem[]
  busy?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  close: []
  submit: [delivery: {
    supplier_name: string
    line: { stock_item_id: string, loose: number, packs: number, line_cost_fen: number, note?: string }
  }]
}>()

const query = ref('')
const selectedId = ref<string | null>(null)
const qtyRaw = ref('')
const costRaw = ref('')
const supplier = ref('')
const note = ref('')

const matches = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return props.items
  return props.items.filter(item => item.name.toLowerCase().includes(needle))
})

const selected = computed(() => props.items.find(item => item.id === selectedId.value) ?? null)
const qty = computed(() => parseDecimalInput(qtyRaw.value))
const costFen = computed(() => parseKm(costRaw.value))
const canSubmit = computed(() =>
  !!selected.value
  && qty.value !== null && qty.value > 0
  && costFen.value !== null && costFen.value > 0
  && supplier.value.trim().length > 0
  && !props.busy)

function submit() {
  if (!selected.value || qty.value === null || qty.value <= 0) return
  if (costFen.value === null || costFen.value <= 0 || !supplier.value.trim()) return
  emit('submit', {
    supplier_name: supplier.value.trim(),
    line: {
      stock_item_id: selected.value.id,
      // The sheet types base units directly; whole packs are the laptop's job.
      packs: 0,
      loose: qty.value,
      line_cost_fen: costFen.value,
      note: note.value.trim() || undefined,
    },
  })
}
</script>

<template>
  <div class="fixed inset-0 z-40">
    <div class="absolute inset-0 bg-black/55" @click="emit('close')" />

    <div
      class="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col gap-3 rounded-t-[20px] border-t border-line bg-surface px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3"
      role="dialog"
      aria-label="Prijem robe"
    >
      <span class="mx-auto h-1 w-10 rounded-full bg-line" />

      <div class="flex items-center gap-2">
        <h2 class="flex-1 text-xl font-bold">
          Prijem robe
        </h2>
        <button type="button" class="btn btn-ghost min-h-11 px-3" @click="emit('close')">
          Otkaži
        </button>
      </div>

      <!-- Step 1: which article -->
      <template v-if="!selected">
        <input
          v-model="query"
          type="search"
          inputmode="search"
          placeholder="Traži artikal…"
          class="card-2 h-12 w-full px-3.5 text-base outline-none placeholder:text-muted"
        >
        <div class="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <button
            v-for="item in matches"
            :key="item.id"
            type="button"
            class="flex w-full items-center gap-3 border-b border-line py-3 text-left last:border-b-0"
            @click="selectedId = item.id"
          >
            <span class="min-w-0 flex-1 truncate">{{ item.name }}</span>
            <span class="num shrink-0 text-sm text-text-2">
              {{ formatStockQty(item.on_hand, item.base_unit) }}
            </span>
          </button>
          <p v-if="matches.length === 0" class="py-6 text-center text-text-2">
            Nema artikla s tim imenom.
          </p>
        </div>
      </template>

      <!-- Step 2: how much of it -->
      <template v-else>
        <button
          type="button"
          class="card-2 flex items-center gap-2 px-3.5 py-3 text-left"
          @click="selectedId = null"
        >
          <span class="min-w-0 flex-1 truncate font-semibold">{{ selected.name }}</span>
          <span class="chip shrink-0">Promijeni</span>
        </button>

        <label class="flex flex-col gap-1.5">
          <span class="text-sm text-text-2">Količina ({{ selected.base_unit }})</span>
          <div class="card-2 flex h-14 items-center gap-2 px-3.5">
            <input
              v-model="qtyRaw"
              type="text"
              inputmode="decimal"
              placeholder="0"
              class="num min-w-0 flex-1 bg-transparent text-2xl font-semibold outline-none placeholder:text-muted"
            >
            <span class="shrink-0 text-text-2">{{ selected.base_unit }}</span>
          </div>
        </label>

        <label class="flex flex-col gap-1.5">
          <span class="text-sm text-text-2">Cijena stavke (KM)</span>
          <div class="card-2 flex h-14 items-center gap-2 px-3.5">
            <input
              v-model="costRaw"
              type="text"
              inputmode="decimal"
              placeholder="0,00"
              class="num min-w-0 flex-1 bg-transparent text-2xl font-semibold outline-none placeholder:text-muted"
            >
            <span class="shrink-0 text-text-2">KM</span>
          </div>
        </label>

        <label class="flex flex-col gap-1.5">
          <span class="text-sm text-text-2">Dobavljač</span>
          <input
            v-model="supplier"
            type="text"
            maxlength="80"
            placeholder="npr. Coca-Cola HBC"
            class="card-2 h-12 w-full px-3.5 text-base outline-none placeholder:text-muted"
          >
        </label>

        <label class="flex flex-col gap-1.5">
          <span class="text-sm text-text-2">Napomena (nije obavezno)</span>
          <input
            v-model="note"
            type="text"
            maxlength="200"
            placeholder="npr. dobavljač, otpremnica"
            class="card-2 h-12 w-full px-3.5 text-base outline-none placeholder:text-muted"
          >
        </label>

        <p v-if="error" class="rounded-xl bg-danger-soft px-3 py-2 text-[15px] text-danger">
          {{ error }}
        </p>

        <button type="button" class="btn btn-accent h-14 w-full" :disabled="!canSubmit" @click="submit">
          {{ busy ? 'Knjižim…' : 'Proknjiži' }}
        </button>
      </template>
    </div>
  </div>
</template>
