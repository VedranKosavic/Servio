<script setup lang="ts">
/**
 * *Prijem robe* — a delivery note, typed the way the invoice in the bartender's
 * hand is laid out: who delivered it, which invoice, when, and then a line per
 * article.
 *
 * WP9 replaced the single-line version with this one, because the route it
 * posts to has always been typed for a whole note (BACKEND §6.8): `supplier_name`,
 * `invoice_no`, `delivered_at` and `lines[]` of `{ packs, loose, line_cost_fen }`.
 * Twelve crates of Coca-Cola and two boxes of coal arrive on one piece of paper
 * and should leave as one ledger entry with one `client_id`, not as two.
 *
 * Three things the form insists on, each for a reason that shows up months later
 * in a report:
 *
 * - **Packs and loose units are separate fields.** "2 gajbe i još 5 flaša" is
 *   how the invoice reads and how the bartender counts; the quantity in base
 *   units is derived (`packs × pack_qty + loose`) and shown back, so a wrong
 *   pack size is visible before it is posted.
 * - **The price is not optional.** It is what the moving average is built from,
 *   and an average built out of zeros quietly turns off every variance, *utrošak*
 *   and *otpis* figure the owner reads (§3.1). A crate you were not charged for
 *   is a *korekcija*, not a delivery — which is why `line_cost_fen` is `min(1)`
 *   on the server too.
 * - **The date is the invoice's, not the clock's.** A delivery booked on Monday
 *   for goods that arrived Saturday belongs on Saturday, or it lands on the wrong
 *   side of a stock count. The server clamps it: never in the future, never
 *   further back than `max_sync_lag_h` (§2).
 *
 * Nothing is posted until *Proknjiži* — a delivery is a ledger row and ledger
 * rows are append-only: a mistake here is corrected by another row, never by an
 * edit (PLAN.md §9).
 */
import { formatKm, parseKm } from '#shared/money'
import type { StockItem } from '#shared/types'

const props = defineProps<{
  items: StockItem[]
  busy?: boolean
  error?: string | null
}>()

/** One line as the sheet holds it: the posted fields plus what it draws. */
interface DeliveryLineDraft {
  stock_item_id: string
  packs: number
  loose: number
  line_cost_fen: number
  note?: string
  /** Display only — never posted; the server names its own items. */
  item_name: string
  qty: number
  base_unit: string
}

const emit = defineEmits<{
  close: []
  submit: [delivery: {
    supplier_name: string
    invoice_no?: string
    delivered_at?: string
    lines: { stock_item_id: string, packs: number, loose: number, line_cost_fen: number, note?: string }[]
  }]
}>()

type Mode = 'note' | 'pick' | 'line'
const mode = ref<Mode>('note')

// -- the note header --------------------------------------------------------

const supplier = ref('')
const invoiceNo = ref('')
/** `yyyy-mm-dd` from the date input; empty means "today", which the server stamps. */
const deliveredOn = ref('')

// -- the lines --------------------------------------------------------------

const draftLines = ref<DeliveryLineDraft[]>([])
const query = ref('')
const selectedId = ref<string | null>(null)
const packsRaw = ref('')
const looseRaw = ref('')
const costRaw = ref('')
const lineNote = ref('')

const matches = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return props.items
  return props.items.filter(item => item.name.toLowerCase().includes(needle))
})

const selected = computed(() => props.items.find(item => item.id === selectedId.value) ?? null)
const packs = computed(() => parseDecimalInput(packsRaw.value) ?? 0)
const loose = computed(() => parseDecimalInput(looseRaw.value) ?? 0)
const costFen = computed(() => parseKm(costRaw.value))

/** `packs × pack_qty + loose`, the same arithmetic the server does. */
const lineQty = computed(() => {
  const item = selected.value
  if (!item) return 0
  const perPack = item.pack_qty ?? 0
  return packs.value * perPack + loose.value
})

/** What one base unit ends up costing — the number the average is built from. */
const unitCostText = computed(() => {
  if (!selected.value || lineQty.value <= 0 || !costFen.value) return null
  const perUnit = costFen.value / lineQty.value
  return `${formatKm(Math.round(perUnit))} / ${selected.value.base_unit}`
})

const lineReady = computed(() =>
  !!selected.value && lineQty.value > 0 && costFen.value !== null && costFen.value > 0)

function pickItem(id: string) {
  selectedId.value = id
  packsRaw.value = ''
  looseRaw.value = ''
  costRaw.value = ''
  lineNote.value = ''
  mode.value = 'line'
}

function addLine() {
  const item = selected.value
  if (!lineReady.value || !item || costFen.value === null) return
  draftLines.value.push({
    stock_item_id: item.id,
    packs: packs.value,
    loose: loose.value,
    line_cost_fen: costFen.value,
    note: lineNote.value.trim() || undefined,
    item_name: item.name,
    qty: lineQty.value,
    base_unit: item.base_unit,
  })
  selectedId.value = null
  query.value = ''
  mode.value = 'note'
}

function removeLine(index: number) {
  draftLines.value.splice(index, 1)
}

const total = computed(() => draftLines.value.reduce((sum, l) => sum + l.line_cost_fen, 0))

const canSubmit = computed(() =>
  draftLines.value.length > 0 && supplier.value.trim().length > 0 && !props.busy)

function submit() {
  if (!canSubmit.value) return
  emit('submit', {
    supplier_name: supplier.value.trim(),
    invoice_no: invoiceNo.value.trim() || undefined,
    delivered_at: isoFromDate(deliveredOn.value),
    lines: draftLines.value.map(l => ({
      stock_item_id: l.stock_item_id,
      packs: l.packs,
      loose: l.loose,
      line_cost_fen: l.line_cost_fen,
      ...(l.note ? { note: l.note } : {}),
    })),
  })
}

/**
 * A picked date becomes local midday rather than midnight: the invoice says a
 * day, not an instant, and midday is the hour that survives every timezone
 * conversion still inside the same day.
 */
function isoFromDate(value: string): string | undefined {
  if (!value) return undefined
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return undefined
  return new Date(y, m - 1, d, 12, 0, 0).toISOString()
}
</script>

<template>
  <div class="fixed inset-0 z-40">
    <div class="absolute inset-0 bg-black/55" @click="emit('close')" />

    <div
      class="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col gap-3 rounded-t-[20px] border-t border-line bg-surface px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3"
      role="dialog"
      aria-label="Prijem robe"
    >
      <span class="mx-auto h-1 w-10 shrink-0 rounded-full bg-line" />

      <div class="flex shrink-0 items-center gap-2">
        <h2 class="flex-1 text-xl font-bold">
          Prijem robe
        </h2>
        <button type="button" class="btn btn-ghost min-h-11 px-3" @click="emit('close')">
          Otkaži
        </button>
      </div>

      <!-- The note: who, which invoice, when, and the lines so far -->
      <div v-if="mode === 'note'" class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
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

        <div class="flex gap-2">
          <label class="flex flex-1 flex-col gap-1.5">
            <span class="text-sm text-text-2">Broj otpremnice</span>
            <input
              v-model="invoiceNo"
              type="text"
              maxlength="40"
              placeholder="nije obavezno"
              class="card-2 h-12 w-full px-3.5 text-base outline-none placeholder:text-muted"
            >
          </label>
          <label class="flex flex-1 flex-col gap-1.5">
            <span class="text-sm text-text-2">Datum</span>
            <input
              v-model="deliveredOn"
              type="date"
              class="card-2 num h-12 w-full px-3.5 text-base outline-none"
            >
          </label>
        </div>

        <div class="flex flex-col gap-2">
          <div
            v-for="(line, index) in draftLines"
            :key="index"
            class="card-2 flex items-center gap-3 px-3.5 py-2.5"
          >
            <div class="min-w-0 flex-1">
              <div class="truncate font-semibold">
                {{ line.item_name }}
              </div>
              <div class="num text-sm text-text-2">
                {{ line.packs ? `${line.packs} pak · ` : '' }}{{ line.loose ? `${line.loose} ${line.base_unit} · ` : '' }}ukupno {{ line.qty }} {{ line.base_unit }}
              </div>
            </div>
            <span class="num shrink-0 font-semibold">{{ formatKm(line.line_cost_fen) }}</span>
            <button
              type="button"
              class="shrink-0 px-1 text-text-2"
              aria-label="Ukloni stavku"
              @click="removeLine(index)"
            >
              ✕
            </button>
          </div>

          <p v-if="draftLines.length === 0" class="rounded-xl bg-surface-2 px-3 py-4 text-center text-[15px] text-text-2">
            Nema stavki. Dodaj šta je stiglo.
          </p>
        </div>

        <button type="button" class="btn h-12" @click="mode = 'pick'">
          + Dodaj stavku
        </button>

        <div v-if="draftLines.length" class="flex items-baseline justify-between border-t border-line pt-2">
          <span class="text-text-2">Ukupno</span>
          <span class="num text-xl font-bold">{{ formatKm(total) }}</span>
        </div>

        <p v-if="error" class="rounded-xl bg-danger-soft px-3 py-2 text-[15px] text-danger" role="alert">
          {{ error }}
        </p>

        <button type="button" class="btn btn-accent h-14 w-full" :disabled="!canSubmit" @click="submit">
          {{ busy ? 'Knjižim…' : 'Proknjiži' }}
        </button>
      </div>

      <!-- Which article -->
      <div v-else-if="mode === 'pick'" class="flex min-h-0 flex-1 flex-col gap-3">
        <input
          v-model="query"
          type="search"
          inputmode="search"
          placeholder="Traži artikal…"
          class="card-2 h-12 w-full shrink-0 px-3.5 text-base outline-none placeholder:text-muted"
        >
        <div class="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <button
            v-for="item in matches"
            :key="item.id"
            type="button"
            class="flex w-full items-center gap-3 border-b border-line py-3 text-left last:border-b-0"
            @click="pickItem(item.id)"
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
        <button type="button" class="btn btn-ghost h-12 shrink-0" @click="mode = 'note'">
          Nazad
        </button>
      </div>

      <!-- How much of it, and what it cost -->
      <div v-else-if="selected" class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <button
          type="button"
          class="card-2 flex items-center gap-2 px-3.5 py-3 text-left"
          @click="mode = 'pick'"
        >
          <span class="min-w-0 flex-1 truncate font-semibold">{{ selected.name }}</span>
          <span class="chip shrink-0">Promijeni</span>
        </button>

        <div class="flex gap-2">
          <label v-if="selected.pack_qty" class="flex flex-1 flex-col gap-1.5">
            <span class="text-sm text-text-2">
              {{ selected.pack_name || 'Pakovanja' }} × {{ selected.pack_qty }}
            </span>
            <input
              v-model="packsRaw"
              type="text"
              inputmode="decimal"
              placeholder="0"
              class="card-2 num h-14 w-full px-3.5 text-2xl font-semibold outline-none placeholder:text-muted"
            >
          </label>

          <label class="flex flex-1 flex-col gap-1.5">
            <span class="text-sm text-text-2">Pojedinačno ({{ selected.base_unit }})</span>
            <input
              v-model="looseRaw"
              type="text"
              inputmode="decimal"
              placeholder="0"
              class="card-2 num h-14 w-full px-3.5 text-2xl font-semibold outline-none placeholder:text-muted"
            >
          </label>
        </div>

        <p v-if="lineQty > 0" class="num text-[15px] text-text-2">
          Ukupno: {{ formatStockQty(lineQty, selected.base_unit) }}
        </p>

        <label class="flex flex-col gap-1.5">
          <span class="text-sm text-text-2">Cijena stavke sa fakture (KM)</span>
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
          <span v-if="unitCostText" class="num text-sm text-text-2">≈ {{ unitCostText }}</span>
          <span v-else class="text-sm text-text-2">Obavezno — iz nje se računa prosječna nabavna cijena.</span>
        </label>

        <label class="flex flex-col gap-1.5">
          <span class="text-sm text-text-2">Napomena (nije obavezno)</span>
          <input
            v-model="lineNote"
            type="text"
            maxlength="200"
            placeholder="npr. gratis gajba, oštećeno"
            class="card-2 h-12 w-full px-3.5 text-base outline-none placeholder:text-muted"
          >
        </label>

        <button type="button" class="btn btn-accent h-14 w-full" :disabled="!lineReady" @click="addLine">
          Dodaj stavku
        </button>
        <button type="button" class="btn btn-ghost h-12" @click="mode = 'note'">
          Nazad
        </button>
      </div>
    </div>
  </div>
</template>
