<script setup lang="ts">
/**
 * *Prijem robe* — the typed delivery note.
 *
 * Three things the server insists on, so the form insists on them too:
 *
 * - **Every line carries what the invoice charged** (`line_cost_fen`, minimum
 *   1 fening). A zero-cost line would drag the item's moving average toward
 *   0,00 KM and quietly make every future variance and *utrošak* meaningless.
 *   Goods you were not charged for are a *korekcija*, not a delivery.
 * - **One `client_id` per posting.** It is the replay key: if the answer is lost
 *   on the way back, the retry returns the stored result instead of booking the
 *   crates a second time. A fresh one is minted only after a success.
 * - **The quantity is packs × pack size + loose**, computed here so the owner
 *   sees the number before he books it.
 *
 * The photo-scan flow in the mockup (*Prijem sa slike*) is Phase 4. There is no
 * upload control here on purpose.
 */
import type { CreateDeliveryBody } from '#shared/schemas'
import type { StockItemAdmin } from '#shared/types'

const props = defineProps<{
  items: StockItemAdmin[]
}>()

const emit = defineEmits<{ posted: [] }>()

const api = useAdminApi()

interface FormLine {
  /** A key for `v-for`; never sent. */
  key: string
  stock_item_id: string
  packs: number | null
  loose: number | null
  line_cost_fen: number | null
  note: string
}

function blankLine(): FormLine {
  return {
    key: crypto.randomUUID(),
    stock_item_id: props.items[0]?.id ?? '',
    packs: null,
    loose: null,
    line_cost_fen: null,
    note: '',
  }
}

const supplier = ref('')
const invoiceNo = ref('')
const deliveredOn = ref('')
const note = ref('')
const lines = ref<FormLine[]>([])
const sending = ref(false)
const error = ref('')
const okText = ref('')

/** A replay key for this posting, replaced only once the server has said yes. */
const clientId = ref(crypto.randomUUID())

watch(() => props.items, (list) => {
  if (lines.value.length === 0 && list.length > 0) lines.value = [blankLine()]
}, { immediate: true })

const options = computed(() => props.items
  .filter(item => item.active)
  .map(item => ({ value: item.id, label: item.name })))

function itemOf(id: string): StockItemAdmin | undefined {
  return props.items.find(item => item.id === id)
}

/** packs × the item's pack size + loose, in the item's base unit. */
function lineQty(line: FormLine): number {
  const item = itemOf(line.stock_item_id)
  const packSize = item?.pack_qty ?? 0
  return (line.packs ?? 0) * packSize + (line.loose ?? 0)
}

function lineQtyText(line: FormLine): string {
  const item = itemOf(line.stock_item_id)
  if (!item) return ''
  return formatStockQty(lineQty(line), item.base_unit)
}

/** What one unit ends up costing — the number that moves the moving average. */
function unitCostText(line: FormLine): string {
  const qty = lineQty(line)
  const cost = line.line_cost_fen ?? 0
  if (qty <= 0 || cost <= 0) return ''
  return `${formatKm(Math.round(cost / qty))} po jedinici`
}

const total = computed(() =>
  lines.value.reduce((sum, line) => sum + (line.line_cost_fen ?? 0), 0))

const problems = computed(() => {
  const list: string[] = []
  if (supplier.value.trim().length === 0) list.push('Upiši dobavljača.')
  if (lines.value.length === 0) list.push('Dodaj bar jednu stavku.')
  for (const line of lines.value) {
    const item = itemOf(line.stock_item_id)
    if (!item) { list.push('Jedna stavka nema odabranu robu.'); continue }
    if (lineQty(line) <= 0) list.push(`${item.name}: količina je 0.`)
    if ((line.line_cost_fen ?? 0) <= 0) list.push(`${item.name}: upiši cijenu sa fakture.`)
    if (!item.pack_qty && (line.packs ?? 0) > 0) {
      list.push(`${item.name} nema veličinu paketa — upiši komade.`)
    }
  }
  return list
})

const canSend = computed(() => problems.value.length === 0)

function addLine() {
  lines.value = [...lines.value, blankLine()]
}

function removeLine(key: string) {
  lines.value = lines.value.filter(line => line.key !== key)
}

/**
 * A date input gives a calendar day; the route wants an instant. Noon UTC is
 * 14:00 in Sarajevo — comfortably inside the day the owner picked, whichever
 * way the clocks have moved. An empty field sends nothing and the server stamps
 * the delivery now.
 */
function deliveredAt(): string | undefined {
  return deliveredOn.value ? `${deliveredOn.value}T12:00:00.000Z` : undefined
}

async function send() {
  if (!canSend.value || sending.value) return
  sending.value = true
  error.value = ''
  okText.value = ''
  try {
    const body: CreateDeliveryBody = {
      client_id: clientId.value,
      supplier_name: supplier.value.trim(),
      invoice_no: invoiceNo.value.trim() || undefined,
      delivered_at: deliveredAt(),
      note: note.value.trim() || undefined,
      lines: lines.value.map(line => ({
        stock_item_id: line.stock_item_id,
        packs: line.packs ?? 0,
        loose: line.loose ?? 0,
        line_cost_fen: line.line_cost_fen ?? 0,
        note: line.note.trim() || undefined,
      })),
    }
    const saved = await api.postDelivery(body)
    okText.value = saved.already_applied
      ? 'Ovaj prijem je već bio proknjižen — ništa nije duplirano.'
      : `Proknjiženo: ${saved.lines.length} stavki · ${formatKm(saved.total_fen)}`
    // A booked delivery is finished. The next one is a new document with a new
    // replay key, so a stale retry can never attach to it.
    clientId.value = crypto.randomUUID()
    supplier.value = ''
    invoiceNo.value = ''
    deliveredOn.value = ''
    note.value = ''
    lines.value = [blankLine()]
    emit('posted')
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <UiCard title="Novi prijem robe">
    <div class="a-head-fields">
      <UiField v-model="supplier" label="Dobavljač" placeholder="Npr. Zvečevo d.o.o." />
      <UiField v-model="invoiceNo" label="Broj otpremnice" placeholder="2026-1189" />
      <UiField v-model="deliveredOn" label="Datum" kind="date" hint="Prazno = danas" />
    </div>

    <div class="a-lines">
      <div v-for="line in lines" :key="line.key" class="a-line">
        <div class="a-line-grid">
          <UiField v-model="line.stock_item_id" label="Roba" kind="select" :options="options" />
          <UiField
            v-model="line.packs"
            label="Paketi"
            kind="decimal"
            :disabled="!itemOf(line.stock_item_id)?.pack_qty"
            :hint="itemOf(line.stock_item_id)?.pack_qty
              ? `${itemOf(line.stock_item_id)?.pack_name} × ${itemOf(line.stock_item_id)?.pack_qty}`
              : 'nema paketa'"
          />
          <UiField v-model="line.loose" label="Komadi" kind="decimal" />
          <UiField v-model="line.line_cost_fen" label="Cijena stavke (KM)" kind="money" :hint="unitCostText(line)" />
        </div>

        <div class="a-line-foot">
          <span class="a-line-qty">Ukupno: {{ lineQtyText(line) }}</span>
          <UiButton
            v-if="lines.length > 1"
            variant="danger"
            small
            @click="removeLine(line.key)"
          >Ukloni</UiButton>
        </div>
      </div>
    </div>

    <UiField v-model="note" label="Napomena" placeholder="Neobavezno" />

    <div class="a-foot">
      <div class="a-total">
        <span class="a-total-label">Ukupno</span>
        <strong><UiMoney :fen="total" /></strong>
      </div>
      <UiButton variant="soft" @click="addLine">Dodaj stavku</UiButton>
      <UiButton variant="primary" :disabled="!canSend" :pending="sending" @click="send">
        Proknjiži
      </UiButton>
    </div>

    <ul v-if="problems.length > 0" class="a-problems">
      <li v-for="problem in problems" :key="problem">{{ problem }}</li>
    </ul>

    <p v-if="error" class="a-error">{{ error }}</p>
    <p v-if="okText" class="a-ok">{{ okText }}</p>
  </UiCard>
</template>

<style scoped>
.a-head-fields {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 12px;
}

.a-lines { display: flex; flex-direction: column; gap: 12px; }

.a-line {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--bg);
}

.a-line-grid {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1.2fr;
  gap: 12px;
}

.a-line-foot { display: flex; align-items: center; gap: 12px; }
.a-line-qty { font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
.a-line-foot .a-btn { margin-left: auto; }

.a-foot { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.a-total { display: flex; align-items: baseline; gap: 8px; margin-right: auto; }
.a-total-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 600; }
.a-total strong { font-size: 20px; font-weight: 600; }

.a-problems { margin: 0; padding-left: 18px; color: var(--muted); font-size: 13px; }
.a-error { margin: 0; color: var(--danger); font-size: 14px; }
.a-ok { margin: 0; color: var(--good); font-size: 14px; }

@media (max-width: 1023px) {
  .a-head-fields { grid-template-columns: 1fr; }
  .a-line-grid { grid-template-columns: 1fr 1fr; }
  /* The article select spans the row — a truncated product name is useless. */
  .a-line-grid > :first-child { grid-column: 1 / -1; }
  .a-foot > .a-btn { flex-grow: 1; }
}
</style>
