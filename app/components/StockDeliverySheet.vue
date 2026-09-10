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
 *
 * **The sheet is three steps and it says which one it is on.** *Prijem robe* →
 * *Odaberi artikal* → *Koliko je stiglo*, each with its own title in the same
 * bar, so a bartender who looks up mid-typing knows where he is. It is built on
 * the system's `.sheet-scrim` / `.sheet-panel` and on `.input` / `.input-num`
 * rather than on hand-rolled `card-2` boxes, so it arrives with the same 260 ms
 * ease as every other sheet in the app and switches off under reduced motion for
 * free (docs/DESIGN.md §5).
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

useSheetDismiss(() => emit('close'))

type Mode = 'note' | 'pick' | 'line'
const mode = ref<Mode>('note')

/** The bar's own title, per step — one sheet, three places to be. */
const STEP: Record<Mode, { eyebrow: string, title: string }> = {
  note: { eyebrow: 'Otpremnica', title: 'Prijem robe' },
  pick: { eyebrow: 'Prijem robe', title: 'Odaberi artikal' },
  line: { eyebrow: 'Prijem robe', title: 'Koliko je stiglo' },
}


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
  <div class="dl">
    <div class="sheet-scrim" @click="emit('close')" />

    <section class="sheet-panel dl-panel" role="dialog" aria-label="Prijem robe">
      <span class="dl-grip" aria-hidden="true" />

      <header class="dl-head">
        <div class="dl-head-lines">
          <p class="eyebrow">{{ STEP[mode].eyebrow }}</p>
          <h2 class="page-title dl-title">{{ STEP[mode].title }}</h2>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" @click="emit('close')">
          Otkaži
        </button>
      </header>

      <!-- The note: who, which invoice, when, and the lines so far -->
      <div v-if="mode === 'note'" class="dl-body">
        <label class="field">
          <span class="eyebrow">Dobavljač</span>
          <input
            v-model="supplier"
            type="text"
            maxlength="80"
            placeholder="npr. Coca-Cola HBC"
            class="input"
          >
        </label>

        <div class="dl-pair">
          <label class="field">
            <span class="eyebrow">Broj otpremnice</span>
            <input
              v-model="invoiceNo"
              type="text"
              maxlength="40"
              placeholder="nije obavezno"
              class="input"
            >
          </label>
          <label class="field">
            <span class="eyebrow">Datum</span>
            <input v-model="deliveredOn" type="date" class="input num">
          </label>
        </div>

        <div v-if="draftLines.length" class="dl-lines">
          <div v-for="(line, index) in draftLines" :key="index" class="dl-line">
            <div class="dl-line-text">
              <span class="dl-line-name">{{ line.item_name }}</span>
              <span class="num dl-line-qty">
                {{ line.packs ? `${line.packs} pak · ` : '' }}{{ line.loose ? `${line.loose} ${line.base_unit} · ` : '' }}ukupno {{ line.qty }} {{ line.base_unit }}
              </span>
            </div>
            <span class="num dl-line-cost">{{ formatKm(line.line_cost_fen) }}</span>
            <button
              type="button"
              class="dl-remove"
              aria-label="Ukloni stavku"
              @click="removeLine(index)"
            >
              <svg
                width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="1.8" stroke-linecap="round" aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div class="dl-total">
            <span class="eyebrow">Ukupno</span>
            <span class="num dl-total-value">{{ formatKm(total) }}</span>
          </div>
        </div>

        <p v-else class="empty">
          Još nema stavki.
          <span>Dodaj šta je stiglo sa otpremnice.</span>
        </p>

        <button type="button" class="btn btn-secondary dl-add" @click="mode = 'pick'">
          <svg
            width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Dodaj stavku
        </button>

        <p v-if="error" class="note note-danger" role="alert">{{ error }}</p>

        <div class="dl-foot">
          <button type="button" class="btn btn-primary btn-lg w-full" :disabled="!canSubmit" @click="submit">
            {{ busy ? 'Knjižim…' : 'Proknjiži' }}
          </button>
        </div>
      </div>

      <!-- Which article -->
      <div v-else-if="mode === 'pick'" class="dl-body dl-body-pick">
        <input
          v-model="query"
          type="search"
          inputmode="search"
          placeholder="Traži artikal…"
          class="input dl-search"
        >

        <div class="dl-hits">
          <button
            v-for="item in matches"
            :key="item.id"
            type="button"
            class="dl-hit"
            @click="pickItem(item.id)"
          >
            <span class="dl-hit-name">{{ item.name }}</span>
            <span class="num dl-hit-qty">
              {{ formatStockQty(item.on_hand, item.base_unit) }}
            </span>
          </button>

          <p v-if="matches.length === 0" class="empty">
            Nema artikla s tim imenom.
          </p>
        </div>

        <div class="dl-foot">
          <button type="button" class="btn btn-secondary w-full" @click="mode = 'note'">
            Nazad
          </button>
        </div>
      </div>

      <!-- How much of it, and what it cost -->
      <div v-else-if="selected" class="dl-body">
        <button type="button" class="dl-chosen" @click="mode = 'pick'">
          <span class="dl-chosen-name">{{ selected.name }}</span>
          <span class="chip">Promijeni</span>
        </button>

        <div class="dl-pair">
          <label v-if="selected.pack_qty" class="field">
            <span class="eyebrow">
              {{ selected.pack_name || 'Pakovanja' }} × {{ selected.pack_qty }}
            </span>
            <input
              v-model="packsRaw"
              type="text"
              inputmode="decimal"
              placeholder="0"
              class="input input-num"
            >
          </label>

          <label class="field">
            <span class="eyebrow">Pojedinačno ({{ selected.base_unit }})</span>
            <input
              v-model="looseRaw"
              type="text"
              inputmode="decimal"
              placeholder="0"
              class="input input-num"
            >
          </label>
        </div>

        <p v-if="lineQty > 0" class="note">
          <span class="num">Ukupno {{ formatStockQty(lineQty, selected.base_unit) }}</span>
        </p>

        <label class="field">
          <span class="eyebrow">Cijena stavke sa fakture (KM)</span>
          <input
            v-model="costRaw"
            type="text"
            inputmode="decimal"
            placeholder="0,00"
            class="input input-num"
          >
          <span v-if="unitCostText" class="num dl-hint">≈ {{ unitCostText }}</span>
          <span v-else class="dl-hint">Obavezno — iz nje se računa prosječna nabavna cijena.</span>
        </label>

        <label class="field">
          <span class="eyebrow">Napomena (nije obavezno)</span>
          <input
            v-model="lineNote"
            type="text"
            maxlength="200"
            placeholder="npr. gratis gajba, oštećeno"
            class="input"
          >
        </label>

        <div class="dl-foot dl-foot-two">
          <button type="button" class="btn btn-secondary" @click="mode = 'note'">
            Nazad
          </button>
          <button type="button" class="btn btn-primary btn-lg dl-grow" :disabled="!lineReady" @click="addLine">
            Dodaj stavku
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.dl {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.dl-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 92dvh;
  padding: 10px 16px 0;
}

/* The handle that says "this came from below and can go back". */
.dl-grip {
  align-self: center;
  flex-shrink: 0;
  width: 40px;
  height: 4px;
  border-radius: var(--radius-chip);
  background: var(--line);
}

.dl-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex-shrink: 0;
  padding-bottom: 4px;
}

.dl-head-lines { flex: 1; min-width: 0; }
.dl-head-lines p { margin: 0; }
.dl-title { margin: 2px 0 0; }

.dl-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding-bottom: calc(16px + env(safe-area-inset-bottom));
}

.dl-body-pick { gap: 10px; }

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dl-pair {
  display: flex;
  gap: 10px;
}

.dl-pair .field { flex: 1; min-width: 0; }

.dl-hint {
  font-size: var(--text-label);
  color: var(--muted);
}

/* ---- the lines on the note --------------------------------------------- */

.dl-lines {
  display: flex;
  flex-direction: column;
}

.dl-line {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line-soft);
}

.dl-line-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dl-line-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dl-line-qty {
  font-size: var(--text-caption);
  color: var(--muted);
}

.dl-line-cost {
  flex-shrink: 0;
  font-weight: 600;
}

.dl-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  margin-right: -10px;
  border: 0;
  border-radius: var(--radius-field);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.dl-total {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding-top: 12px;
}

.dl-total .eyebrow { flex: 1; }

.dl-total-value {
  font-size: var(--text-section);
  font-weight: 700;
  color: var(--ink);
}

.dl-add { width: 100%; }

/* ---- picking an article ------------------------------------------------- */

.dl-search { flex-shrink: 0; }

.dl-hits {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
}

.dl-hit {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 56px;
  padding: 8px 0;
  border: 0;
  border-bottom: 1px solid var(--line-soft);
  background: transparent;
  color: var(--ink);
  font-size: var(--text-body);
  text-align: left;
  cursor: pointer;
}

.dl-hit:last-child { border-bottom: 0; }

.dl-hit-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dl-hit-qty {
  flex-shrink: 0;
  font-size: var(--text-label);
  color: var(--muted);
}

.dl-chosen {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 56px;
  padding: 8px 14px;
  border-radius: var(--radius-card);
  border: 1px solid var(--line-soft);
  background: var(--surface-2);
  color: var(--ink);
  font-size: var(--text-body);
  cursor: pointer;
}

.dl-chosen-name {
  flex: 1;
  min-width: 0;
  text-align: left;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- the foot ----------------------------------------------------------- */

/* The sheet's own action bar: it sits on the panel's material so the fields
   scroll under it rather than behind a gradient of the page ground. */
.dl-foot {
  position: sticky;
  bottom: 0;
  margin-top: auto;
  padding: 12px 0 calc(4px + env(safe-area-inset-bottom));
  background: var(--surface);
}

.dl-foot-two {
  display: flex;
  gap: 10px;
}

.dl-grow { flex: 1; }
</style>
