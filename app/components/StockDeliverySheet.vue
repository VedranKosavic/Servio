<script setup lang="ts">
/**
 * *Prijem robe* — a bottom sheet with one line: what arrived, and how much.
 *
 * Quantities are typed in the item's base unit (grams for tobacco, pieces for
 * bottles), because that is the unit the ledger stores; a comma is accepted as
 * the decimal separator since that is what a Bosnian keyboard offers.
 *
 * Nothing is posted until *Proknjiži* — a delivery is a ledger row and ledger
 * rows are append-only: a mistake here is corrected by another row, never by an
 * edit (PLAN.md §9).
 */
import type { StockItem } from '#shared/types'

const props = defineProps<{
  items: StockItem[]
  busy?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  close: []
  submit: [line: { stock_item_id: string, qty: number, note?: string }]
}>()

const query = ref('')
const selectedId = ref<string | null>(null)
const qtyRaw = ref('')
const note = ref('')

const matches = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return props.items
  return props.items.filter(item => item.name.toLowerCase().includes(needle))
})

const selected = computed(() => props.items.find(item => item.id === selectedId.value) ?? null)
const qty = computed(() => parseDecimalInput(qtyRaw.value))
const canSubmit = computed(() => !!selected.value && qty.value !== null && qty.value > 0 && !props.busy)

function submit() {
  if (!selected.value || qty.value === null || qty.value <= 0) return
  emit('submit', {
    stock_item_id: selected.value.id,
    qty: qty.value,
    note: note.value.trim() || undefined,
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
