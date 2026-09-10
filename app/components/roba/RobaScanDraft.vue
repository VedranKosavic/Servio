<script setup lang="ts">
/**
 * The scanned otpremnica, open and fully editable (PHASE4 WP3).
 *
 * **Nothing here is posted by the scan.** The model read a photograph; what it
 * produced is a draft. The owner corrects every line and *Proknjiži* calls the
 * **existing** `POST /api/stock/deliveries` with `source: 'scan'` and the
 * `scan_id` — the movements, the moving average and the `delivery_posted` entry
 * are the code that already works, and the route flips the scan to `applied` in
 * the same transaction as the delivery.
 *
 * Two rules the screen enforces, both from §2.9:
 *
 * - **Every line has to be looked at.** An unknown line has no article behind
 *   it, so it is either given one (*Poveži* / *Novi artikal*) or deliberately
 *   *Preskoči*-ed. *Proknjiži* stays grey until none is left undecided.
 * - **The price is a suggestion.** The catalogue does not know what the supplier
 *   charged this week; the model's number is a starting point, exactly like the
 *   typed form's `line_cost_fen`, and a line costing 0,00 KM is refused for the
 *   same reason there: a free crate would drag the moving average toward zero
 *   and quietly make every future variance meaningless.
 */
import type { CreateDeliveryBody } from '#shared/schemas'
import type { ScanDraft, StockItemAdmin } from '#shared/types'
import type { ScanFormLine } from '~/composables/useScan'

const props = defineProps<{
  draft: ScanDraft
  items: StockItemAdmin[]
}>()

const emit = defineEmits<{
  posted: []
  /** *Odbaci sken* with a reason — the hourly collector then unlinks the photo. */
  discard: [reason: string]
  /** A *Novi artikal* was created; the page reloads the catalogue. */
  catalogue: []
}>()

const api = useAdminApi()

/**
 * Articles created from this draft, before the page's catalogue reload comes
 * back. Kept beside the prop rather than pushed into it: a child never mutates
 * what its parent owns.
 */
const added = ref<StockItemAdmin[]>([])

const allItems = computed(() => [
  ...props.items,
  ...added.value.filter(extra => !props.items.some(item => item.id === extra.id)),
])

const supplier = ref('')
const invoiceNo = ref('')
const deliveredOn = ref('')
const note = ref('')
const lines = ref<ScanFormLine[]>([])
const sending = ref(false)
const error = ref('')
const touched = ref(false)

/** A replay key for this posting; a retry returns the stored delivery, never a second one. */
const clientId = ref(crypto.randomUUID())

/** An ISO date the model read is a `YYYY-MM-DD`; anything else is left blank. */
function asDateInput(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
}

watch(() => props.draft, (draft) => {
  supplier.value = draft.supplier ?? ''
  invoiceNo.value = (draft.invoice_no ?? '').slice(0, 40)
  deliveredOn.value = asDateInput(draft.date)
  note.value = ''
  lines.value = draft.lines.map(line => toFormLine(line, allItems.value))
  clientId.value = crypto.randomUUID()
  error.value = ''
  touched.value = false
}, { immediate: true })

/**
 * The catalogue is fetched on mount and the scan happens later, so `items` is
 * normally already here. If it is not, the split between packs and loose was
 * made without knowing the pack size — redo it, but only while the owner has
 * not touched anything.
 */
watch(() => props.items.length, (now, before) => {
  if (before === 0 && now > 0 && !touched.value) {
    lines.value = props.draft.lines.map(line => toFormLine(line, allItems.value))
  }
})

function itemOf(id: string): StockItemAdmin | undefined {
  return allItems.value.find(item => item.id === id)
}

function lineQty(line: ScanFormLine): number {
  const packSize = itemOf(line.stock_item_id)?.pack_qty ?? 0
  return (line.packs ?? 0) * packSize + (line.loose ?? 0)
}

/**
 * The owner picked a different article: re-split the quantity the model read,
 * because "2" means two gajbe on a packed item and two pieces on a loose one.
 */
function pickItem(line: ScanFormLine, id: string) {
  line.stock_item_id = id
  const { packs, loose } = splitQty(line.qty, itemOf(id))
  line.packs = packs || null
  line.loose = loose || null
  if (line.line_cost_fen === null && line.unit_price_fen !== null) {
    line.line_cost_fen = Math.round(line.unit_price_fen * (line.qty ?? 0)) || null
  }
  touched.value = true
}

// -- Poveži / Novi artikal ---------------------------------------------------

const linking = ref<ScanFormLine | null>(null)
const creating = ref<ScanFormLine | null>(null)

/** A line that just got an article stops being unknown — that is the whole point. */
function attach(line: ScanFormLine, id: string) {
  pickItem(line, id)
  line.match = line.match === 'unknown' ? 'green' : line.match
  line.from_alias = true
}

function onLinked(id: string) {
  const line = linking.value
  linking.value = null
  if (line) attach(line, id)
}

function onCreated(item: StockItemAdmin) {
  const line = creating.value
  creating.value = null
  emit('catalogue')
  // The catalogue reload is a round trip; the new row is held locally so the
  // select has something to show the moment the sheet closes.
  added.value = [...added.value, item]
  if (line) attach(line, item.id)
}

// -- Šta još fali ------------------------------------------------------------

const live = computed(() => lines.value.filter(line => !line.skipped))

/** The one row that gets the keyboard when the draft opens. */
const firstAmberKey = computed(() =>
  lines.value.find(line => line.match === 'amber')?.key ?? null)

const counts = computed(() => ({
  green: lines.value.filter(l => !l.skipped && l.match === 'green').length,
  amber: lines.value.filter(l => !l.skipped && l.match === 'amber').length,
  unknown: lines.value.filter(l => !l.skipped && l.match === 'unknown' && !l.stock_item_id).length,
  skipped: lines.value.filter(l => l.skipped).length,
}))

const countsText = computed(() => {
  const parts = [
    `${counts.value.green} prepoznato`,
    `${counts.value.amber} nesigurno`,
    `${counts.value.unknown} nepoznato`,
  ]
  if (counts.value.skipped > 0) parts.push(`${counts.value.skipped} preskočeno`)
  return parts.join(' · ')
})

const problems = computed(() => {
  const list: string[] = []
  if (supplier.value.trim().length === 0) list.push('Upiši dobavljača.')
  if (live.value.length === 0) list.push('Nijedan red nije za knjiženje.')
  for (const line of live.value) {
    const item = itemOf(line.stock_item_id)
    if (!item) {
      list.push(`„${line.text}“: poveži red s artiklom ili ga preskoči.`)
      continue
    }
    if (lineQty(line) <= 0) list.push(`${item.name}: količina je 0.`)
    if ((line.line_cost_fen ?? 0) <= 0) list.push(`${item.name}: upiši cijenu sa otpremnice.`)
    if (!item.pack_qty && (line.packs ?? 0) > 0) {
      list.push(`${item.name} nema veličinu paketa — upiši komade.`)
    }
  }
  return list
})

const canPost = computed(() => problems.value.length === 0)

const total = computed(() => live.value.reduce((sum, line) => sum + (line.line_cost_fen ?? 0), 0))

/**
 * A date input gives a calendar day; the route wants an instant. Noon UTC is
 * 14:00 in Sarajevo — inside the day the owner picked whichever way the clocks
 * have moved. Empty sends nothing and the server stamps the delivery now.
 */
function deliveredAt(): string | undefined {
  return deliveredOn.value ? `${deliveredOn.value}T12:00:00.000Z` : undefined
}

async function post() {
  if (!canPost.value || sending.value) return
  sending.value = true
  error.value = ''
  try {
    const body: CreateDeliveryBody = {
      client_id: clientId.value,
      supplier_name: supplier.value.trim(),
      invoice_no: invoiceNo.value.trim() || undefined,
      delivered_at: deliveredAt(),
      note: note.value.trim() || undefined,
      source: 'scan',
      scan_id: props.draft.scan_id,
      lines: live.value.map(line => ({
        stock_item_id: line.stock_item_id,
        packs: line.packs ?? 0,
        loose: line.loose ?? 0,
        line_cost_fen: line.line_cost_fen ?? 0,
      })),
    }
    await api.postDelivery(body)
    emit('posted')
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    sending.value = false
  }
}

// -- Odbaci sken -------------------------------------------------------------

const discarding = ref(false)
const discardReason = ref('')

function confirmDiscard() {
  if (discardReason.value.trim().length < 3) return
  emit('discard', discardReason.value.trim())
  discarding.value = false
  discardReason.value = ''
}
</script>

<template>
  <UiCard title="Prijem sa slike" :count="countsText" @input="touched = true" @change="touched = true">
    <template #actions>
      <UiButton small variant="ghost" @click="discarding = true">Odbaci sken</UiButton>
    </template>

    <div class="a-top">
      <RobaScanFoto :src="draft.image_url" alt="Otpremnica" />

      <div class="a-head-fields">
        <UiField v-model="supplier" label="Dobavljač" placeholder="Npr. Zvečevo d.o.o." />
        <UiField v-model="invoiceNo" label="Broj otpremnice" placeholder="2026-1189" />
        <UiField v-model="deliveredOn" label="Datum" kind="date" hint="Prazno = danas" />
      </div>
    </div>

    <p v-if="draft.error" class="a-warn">
      Sliku nije bilo moguće pročitati do kraja. Provjeri svaki red ili unesi prijem ručno.
    </p>

    <p class="a-muted">
      Cijene sa slike su prijedlog — ispravi ih prije knjiženja. Ništa se ne knjiži
      dok ne pregledaš svaki red.
    </p>

    <div class="a-lines">
      <RobaScanLine
        v-for="line in lines"
        :key="line.key"
        :line="line"
        :items="allItems"
        :locked="sending"
        :focus-item="line.key === firstAmberKey"
        @pick="pickItem(line, $event)"
        @link="linking = line"
        @create="creating = line"
        @skip="line.skipped = true; touched = true"
        @restore="line.skipped = false"
      />
    </div>

    <UiField v-model="note" label="Napomena" placeholder="Neobavezno" />

    <div class="a-foot">
      <div class="a-total">
        <span class="a-total-label">Ukupno</span>
        <strong><UiMoney :fen="total" /></strong>
      </div>
      <!-- The wrapper catches the click a disabled button swallows, so asking
           why *Proknjiži* is grey is what shows the list of reasons. -->
      <span @click="touched = true">
        <UiButton variant="primary" :disabled="!canPost" :pending="sending" @click="post">
          Proknjiži
        </UiButton>
      </span>
    </div>

    <ul v-if="touched && problems.length > 0" class="a-problems">
      <li v-for="problem in problems" :key="problem">{{ problem }}</li>
    </ul>

    <p v-if="error" class="a-error">{{ error }}</p>

    <RobaScanPovezi
      :open="linking !== null"
      :text="linking?.text ?? ''"
      :supplier="supplier || null"
      :items="allItems"
      @close="linking = null"
      @linked="onLinked"
    />

    <RobaScanNoviArtikal
      :open="creating !== null"
      :text="creating?.text ?? ''"
      :supplier="supplier || null"
      @close="creating = null"
      @created="onCreated"
    />

    <UiSheet
      :open="discarding"
      title="Odbaci sken"
      @close="discarding = false"
      @confirm="confirmDiscard"
    >
      <p class="a-muted">
        Sken se odbacuje bez knjiženja, a slika se briše sa servera u toku sata.
        Napiši zašto.
      </p>
      <UiField
        v-model="discardReason"
        label="Razlog"
        kind="textarea"
        placeholder="Npr. slika je mutna"
      />
      <template #footer>
        <UiButton variant="ghost" @click="discarding = false">Odustani</UiButton>
        <UiButton
          variant="danger"
          :disabled="discardReason.trim().length < 3"
          @click="confirmDiscard"
        >Odbaci</UiButton>
      </template>
    </UiSheet>
  </UiCard>
</template>

<style scoped>
.a-top { display: grid; grid-template-columns: 280px 1fr; gap: 16px; align-items: start; }
.a-head-fields { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 12px; }

.a-lines { display: flex; flex-direction: column; gap: 12px; }

.a-foot { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.a-total { display: flex; align-items: baseline; gap: 8px; margin-right: auto; }
.a-total-label { font-size: var(--text-caption); text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 600; }
.a-total strong {
  font-family: var(--font-display);
  font-size: var(--text-title);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.a-foot span > :deep(button:disabled) { pointer-events: none; }

.a-problems { margin: 0; padding-left: 18px; color: var(--muted); font-size: var(--text-micro); }
.a-muted { margin: 0; color: var(--muted); font-size: var(--text-micro); }
.a-warn { margin: 0; color: var(--warn); font-size: var(--text-label); }
.a-error { margin: 0; color: var(--danger); font-size: var(--text-label); }

@media (max-width: 1023px) {
  .a-top { grid-template-columns: 1fr; }
  .a-head-fields { grid-template-columns: 1fr; }
  .a-foot > .a-btn { flex-grow: 1; }
}
</style>
