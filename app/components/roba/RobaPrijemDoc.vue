<script setup lang="ts">
/**
 * *Prijem robe* — one delivery note, built the way one is read.
 *
 * **It is a document, not a form.** The old screen was a wall of four-column
 * line blocks with a supplier, an invoice number, a date and a note above them,
 * and every one of those fields was equally loud — so the owner met eleven
 * inputs before he could say the one thing he came to say, which is *what
 * arrived*. Now there is one act repeated: **pick an article, say how many, say
 * what it cost, add it.** The lines pile up underneath, and the document is
 * concluded at the foot with the date and the amount written on the paper.
 *
 * **Two more fields are gone, on the owner's call: *Dobavljač* and *Napomena*.**
 * `supplier_name` is optional in the schema now rather than sent as an empty
 * string (`shared/schemas/stock.ts`), and what a delivery is accountable by did
 * not move: the server takes the person from the session and the history lists
 * him on every row. *Prijem sa slike* still fills a supplier in — it reads one
 * off the photograph, and nobody types it.
 *
 * **The article is picked in a sheet, not in a `<select>`.** See
 * `RobaArtikalPicker.vue`: search, and the same three sections as *Stanje
 * šanka*. The OS wheel of nineteen names it replaces is the control this screen
 * is used through, which is why it got the work.
 *
 * **Quantity is one number, in the article's own unit.** The route still takes
 * `packs` and `loose` and computes `qty = packs × pack_qty + loose`, so this
 * screen sends the whole quantity as `loose` and nothing is lost — "Coca-Cola
 * ×36" is 36, not "1 gajba + 12", and the field's hint names the crate for
 * anybody who would rather multiply it himself.
 *
 * **Why the money is per line and not one figure.** The owner types the total
 * from the invoice at the foot, which is what he asked for — but it is a
 * *check*, not the source. `POST /api/stock/deliveries` prices each article from
 * its own `line_cost_fen`, and that number is what the moving average is built
 * from: a document total spread across the lines by some rule would charge a
 * bottle of rakija the same as a Coca-Cola and quietly make every future
 * variance, *utrošak* and waste value wrong. So each line carries what the
 * invoice charged for it, the foot adds them up, and the amount the owner types
 * is compared against that sum — which is the one place a delivery entered
 * wrongly can be caught while the paper is still in his hand.
 *
 * Three things the route insists on, unchanged since Korak 2 (§6.8):
 *
 * - **`line_cost_fen` is at least 1 fening.** Goods you were not charged for are
 *   a *korekcija*, not a delivery.
 * - **One `client_id` per document.** It is the replay key: a lost answer
 *   retries into the stored result instead of booking the crates twice. A fresh
 *   one is minted only after a success.
 * - **The actor comes from the session.** No body ever names who entered it,
 *   which is exactly what makes the history worth reading.
 */
import type { CreateDeliveryBody } from '#shared/schemas'
import type { StockItemAdmin } from '#shared/types'

const props = defineProps<{
  items: StockItemAdmin[]
}>()

const emit = defineEmits<{
  posted: []
  /** Hand over to the photo flow; the page swaps this card for `RobaScanCard`. */
  scan: []
}>()

const api = useAdminApi()

/** One article on the document, before it is posted. */
interface DocLine {
  /** A key for `v-for` and for the sheet; never sent. */
  key: string
  stock_item_id: string
  /** In the article's base unit. Sent as `loose`, so `qty` is exactly this. */
  qty: number
  line_cost_fen: number
}

const lines = ref<DocLine[]>([])

// -- the adder ---------------------------------------------------------------

const pickId = ref('')
const pickQty = ref<number | null>(null)
const pickCost = ref<number | null>(null)

/** The picker sheet. Closed by a choice, which is its only job. */
const pickerOpen = ref(false)

/**
 * Nothing is preselected, and that is the change from the `<select>`.
 *
 * A select has to hold a value to render, so it opened the document already
 * pointing at whatever happened to be first in the catalogue — and a quantity
 * typed under a name nobody read is a crate of the wrong article. The button
 * says *Izaberi artikal* until somebody picks one, and *Dodaj* stays grey.
 */
function itemOf(id: string): StockItemAdmin | undefined {
  return props.items.find(item => item.id === id)
}

const pickedName = computed(() => itemOf(pickId.value)?.name ?? '')

function pick(id: string) {
  pickId.value = id
  pickerOpen.value = false
  // The suggestion follows the article: a cost typed for the previous one is
  // not this one's price, so the field goes back to suggesting.
  costTouched.value = false
  pickCost.value = suggestedCost(itemOf(id), pickQty.value)
}

/** "kom · gajba = 24 kom" — the unit, and the crate for anybody multiplying. */
const qtyHint = computed(() => {
  const item = itemOf(pickId.value)
  if (!item) return ''
  const pack = item.pack_qty && item.pack_name
    ? ` · ${item.pack_name} = ${item.pack_qty} ${item.base_unit}`
    : ''
  return `${item.base_unit}${pack}`
})

/**
 * The amount fills itself in from the last invoice, and the owner corrects it
 * only when the price has actually moved.
 *
 * The owner asked for this screen to be "select which items got ordered (for
 * example we pick coca-cola x36)" and then one date and one total — an article
 * and a quantity, nothing else. The server cannot quite give him that: every
 * line carries its own `line_cost_fen`, and that number is what the moving
 * average, *utrošak* and every future variance are built from. Spreading one
 * invoice total evenly across the lines would price rakija like a Coca-Cola and
 * quietly corrupt all three.
 *
 * So the typing is removed rather than the number. `last_cost_mfen` is already
 * on `StockItemAdmin` — it is what the previous delivery charged — so
 * `qty × last cost` is almost always exactly right, and a delivery of six
 * familiar articles becomes six taps on *Dodaj*. The foot still asks for the
 * amount written on the paper and warns when the two disagree, which is what
 * catches the one line whose price did move.
 *
 * `costTouched` is why this is a watcher and not a computed: the moment the
 * owner types over the suggestion it must stop suggesting, or his figure would
 * be overwritten by the next keystroke in the quantity field.
 */
const costTouched = ref(false)

/** `mfen` is milli-feninga — a thousandth of a fening, so costs survive division. */
function suggestedCost(item: StockItemAdmin | undefined, qty: number | null): number | null {
  if (!item || !qty || qty <= 0) return null
  if (item.last_cost_mfen <= 0) return null
  return Math.round((item.last_cost_mfen * qty) / 1000)
}

watch([pickId, pickQty], () => {
  if (costTouched.value) return
  pickCost.value = suggestedCost(itemOf(pickId.value), pickQty.value)
})

/** True while the field is showing a guess the owner has not confirmed. */
const costIsSuggested = computed(() =>
  !costTouched.value
  && pickCost.value !== null
  && pickCost.value === suggestedCost(itemOf(pickId.value), pickQty.value))

const costHint = computed(() => {
  if (!costIsSuggested.value) return 'sa fakture'
  const item = itemOf(pickId.value)
  return item?.estimated_cost ? 'procijenjeno — provjeri' : 'po prošloj fakturi'
})

const canAdd = computed(() =>
  !!itemOf(pickId.value) && (pickQty.value ?? 0) > 0 && (pickCost.value ?? 0) > 0)

function add() {
  if (!canAdd.value) return
  lines.value = [...lines.value, {
    key: crypto.randomUUID(),
    stock_item_id: pickId.value,
    qty: pickQty.value!,
    line_cost_fen: pickCost.value!,
  }]
  // The article stays picked and the two numbers clear: a delivery note is
  // usually several sizes of the same supplier's goods, and re-picking the
  // article he just picked is the tap this screen can most afford to save.
  pickQty.value = null
  pickCost.value = null
  costTouched.value = false
}

// -- the lines ---------------------------------------------------------------

/** The line whose sheet is open, by key. Editing and removing both live there. */
const openKey = ref<string | null>(null)
const openLine = computed(() => lines.value.find(line => line.key === openKey.value) ?? null)

function saveLine(patch: { qty: number, line_cost_fen: number }) {
  const line = openLine.value
  if (line) {
    line.qty = patch.qty
    line.line_cost_fen = patch.line_cost_fen
  }
  openKey.value = null
}

function removeLine() {
  lines.value = lines.value.filter(line => line.key !== openKey.value)
  openKey.value = null
}

function nameOf(id: string): string {
  return itemOf(id)?.name ?? 'Nepoznat artikal'
}

function qtyText(line: DocLine): string {
  const item = itemOf(line.stock_item_id)
  return item ? formatStockQty(line.qty, item.base_unit) : String(line.qty)
}

// -- the foot ----------------------------------------------------------------

const deliveredOn = ref('')
const writtenFen = ref<number | null>(null)
const sending = ref(false)
const error = ref('')
const okText = ref('')
const touched = ref(false)

/** A replay key for this document, replaced only once the server has said yes. */
const clientId = ref(crypto.randomUUID())

/** What the lines add up to — the number the route will store as `total_fen`. */
const total = computed(() =>
  lines.value.reduce((sum, line) => sum + line.line_cost_fen, 0))

/**
 * "1 stavka · 2 stavke · 7 stavki".
 *
 * Bosnian counts in three forms and the rule differs per noun, which is why the
 * house rule is not to generate a plural for a word the owner typed (a pack name
 * is "3 × gajba" for exactly that reason). *Stavka* is not one of those: it is
 * one fixed word in the product's own vocabulary, and its three forms are
 * knowable, so the sentence that confirms a posting can be written correctly
 * rather than in the genitive plural that reads wrong at one.
 */
function stavkeBs(n: number): string {
  if (n === 1) return '1 stavka'
  if (n >= 2 && n <= 4) return `${n} stavke`
  return `${n} stavki`
}

/**
 * The written amount and the lines disagree.
 *
 * A warning and never a refusal: an invoice legitimately rounds, discounts a
 * crate or carries a deposit line nothing on the shelf corresponds to. What it
 * must never do is pass unnoticed, because a delivery entered a digit short is
 * exactly the shape theft takes on this screen.
 */
const mismatch = computed(() =>
  writtenFen.value !== null && writtenFen.value !== total.value)

const problems = computed(() => {
  const list: string[] = []
  if (lines.value.length === 0) list.push('Dodaj bar jedan artikal.')
  if (deliveredOn.value.length === 0) list.push('Upiši datum sa fakture.')
  if ((writtenFen.value ?? 0) <= 0) list.push('Upiši iznos koji piše na fakturi.')
  return list
})

const canSend = computed(() => problems.value.length === 0)

/**
 * A date input gives a calendar day; the route wants an instant. Noon UTC is
 * 14:00 in Sarajevo — comfortably inside the day the owner picked, whichever way
 * the clocks have moved.
 */
function deliveredAt(): string {
  return `${deliveredOn.value}T12:00:00.000Z`
}

async function send() {
  if (!canSend.value || sending.value) return
  sending.value = true
  error.value = ''
  okText.value = ''
  try {
    const body: CreateDeliveryBody = {
      client_id: clientId.value,
      // No `supplier_name` and no `note`: the two fields the owner removed are
      // **absent** from the body rather than sent empty (see the top).
      delivered_at: deliveredAt(),
      lines: lines.value.map(line => ({
        stock_item_id: line.stock_item_id,
        // The whole quantity as loose units: `qty = packs × pack_qty + loose`,
        // and this screen counts in the article's own unit (see the top).
        packs: 0,
        loose: line.qty,
        line_cost_fen: line.line_cost_fen,
      })),
    }
    const saved = await api.postDelivery(body)
    okText.value = saved.already_applied
      ? 'Ovaj prijem je već bio proknjižen — ništa nije duplirano.'
      : `Proknjiženo · ${stavkeBs(saved.lines.length)} · ${formatKm(saved.total_fen)}. Roba je na stanju šanka.`
    // A booked delivery is finished. The next one is a new document with a new
    // replay key, so a stale retry can never attach to it.
    clientId.value = crypto.randomUUID()
    lines.value = []
    deliveredOn.value = ''
    writtenFen.value = null
    pickQty.value = null
    pickCost.value = null
    costTouched.value = false
    touched.value = false
    emit('posted')
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <UiCard title="Novi prijem robe" @input="touched = true" @change="touched = true">
    <template #actions>
      <!-- The photo is a *way to start this document*, not a rival screen: it
           produces the same lines and posts through the same route. -->
      <UiButton small variant="ghost" @click="emit('scan')">Sa slike</UiButton>
    </template>

    <!-- ---- pick an article -------------------------------------------- -->
    <div class="d-add">
      <!-- A button drawn as a field: the row reads as three fields and one
           action, and what it opens is `RobaArtikalPicker`. -->
      <div class="d-pick">
        <span id="d-pick-label" class="d-pick-label">Artikal</span>
        <button
          type="button"
          class="d-pick-btn"
          :class="{ unset: !pickedName }"
          aria-haspopup="dialog"
          aria-labelledby="d-pick-label"
          @click="pickerOpen = true"
        >
          <span class="d-pick-name">{{ pickedName || 'Izaberi artikal' }}</span>
          <svg
            width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
            class="d-pick-chevron" aria-hidden="true"
          ><path d="M6 9l6 6 6-6" /></svg>
        </button>
      </div>

      <UiField v-model="pickQty" label="Količina" kind="decimal" :hint="qtyHint" />
      <UiField
        v-model="pickCost"
        label="Iznos (KM)"
        kind="money"
        :hint="costHint"
        @update:model-value="costTouched = true"
      />
      <div class="d-add-act">
        <UiButton variant="soft" :disabled="!canAdd" @click="add">
          <!-- The kit has no plus. Same 24 px grid and 1.8 stroke as `UiIcon`. -->
          <svg
            width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" aria-hidden="true"
          ><path d="M12 5v14M5 12h14" /></svg>
          Dodaj
        </UiButton>
      </div>
    </div>

    <!-- ---- what is on the document ------------------------------------ -->
    <div v-if="lines.length > 0" class="d-lines">
      <button
        v-for="line in lines"
        :key="line.key"
        type="button"
        class="d-line"
        :aria-label="`Izmijeni, ${nameOf(line.stock_item_id)}`"
        @click="openKey = line.key"
      >
        <span class="d-line-name">{{ nameOf(line.stock_item_id) }}</span>
        <span class="d-line-qty num">{{ qtyText(line) }}</span>
        <span class="d-line-cost num"><UiMoney :fen="line.line_cost_fen" :colour="false" /></span>
      </button>
    </div>

    <p v-else class="d-empty">
      Još nijedan artikal nije dodan. Izaberi robu, upiši koliko je stiglo i
      koliko piše na fakturi.
    </p>

    <!-- ---- conclude --------------------------------------------------- -->
    <div class="d-foot">
      <p class="d-foot-title">Zaključivanje prijema</p>

      <div class="d-foot-fields">
        <UiField v-model="deliveredOn" label="Datum sa fakture" kind="date" />
        <UiField v-model="writtenFen" label="Iznos sa fakture (KM)" kind="money" />
      </div>

      <div class="d-total">
        <span class="d-total-label">Zbir artikala</span>
        <strong class="num"><UiMoney :fen="total" :colour="false" /></strong>
      </div>

      <p v-if="mismatch" class="d-warn">
        Zbir artikala i iznos sa fakture se ne poklapaju. Provjeri stavke —
        prijem se svejedno može proknjižiti.
      </p>

      <!-- The wrapper catches the click the disabled button swallows, so asking
           why *Proknjiži* is grey is what shows the list of reasons. -->
      <span class="d-send" @click="touched = true">
        <UiButton variant="primary" :disabled="!canSend" :pending="sending" @click="send">
          Proknjiži
        </UiButton>
      </span>

      <ul v-if="touched && problems.length > 0" class="d-problems">
        <li v-for="problem in problems" :key="problem">{{ problem }}</li>
      </ul>
    </div>

    <p v-if="error" class="d-error">{{ error }}</p>
    <p v-if="okText" class="d-ok" role="status">{{ okText }}</p>

    <RobaArtikalPicker
      :open="pickerOpen"
      :items="items"
      :selected-id="pickId"
      @close="pickerOpen = false"
      @pick="pick"
    />

    <RobaPrijemLinijaSheet
      :open="openLine !== null"
      :name="openLine ? nameOf(openLine.stock_item_id) : ''"
      :unit-hint="openLine ? (itemOf(openLine.stock_item_id)?.base_unit ?? '') : ''"
      :qty="openLine?.qty ?? 0"
      :line-cost-fen="openLine?.line_cost_fen ?? 0"
      @close="openKey = null"
      @save="saveLine"
      @remove="removeLine"
    />
  </UiCard>
</template>

<style scoped>
/* ---- the adder ---------------------------------------------------------- */

/**
 * The three cells line up on their **labels**, not on their bottoms.
 *
 * They are not the same height — a picker is a 44 px target (DESIGN §3 puts that
 * floor under "pick one of a set") and a text field is 40, and only one of the
 * three carries a hint under it — so bottom-aligning them staggered the three
 * uppercase labels down the row like a badly set table. Aligned at the top the
 * labels sit on one line, which is the line the eye reads the row by. The button
 * keeps to the bottom, where the fields end.
 */
.d-add {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) auto;
  align-items: start;
  gap: 12px;
}

.d-add-act { display: flex; align-self: end; }

/* ---- the article, as a field that opens a sheet ------------------------- */

/**
 * Drawn as `UiField` draws a select — the same label, the same slot height, the
 * same chevron — because it is the same job and the row it sits in is three
 * fields wide. What it is underneath is a button, so what it opens can be a
 * sheet with a search in it instead of the operating system's wheel.
 */
.d-pick { display: flex; flex-direction: column; gap: 6px; min-width: 0; }

.d-pick-label {
  font-size: var(--text-caption);
  line-height: 1.3;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--muted);
  font-weight: 600;
}

.d-pick-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: var(--tap);
  padding: 0 10px 0 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-field);
  background: var(--field-bg);
  font: inherit;
  font-size: var(--text-body);
  color: var(--ink);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-standard);
}

.d-pick-btn:hover { border-color: var(--muted); }

.d-pick-btn:focus-visible {
  outline: 2px solid var(--accent-text);
  outline-offset: -1px;
  border-color: var(--accent-line);
}

/* Nothing chosen yet: the words are a placeholder, not a value. The modifier
   is `unset` and not `empty`, because `.empty` is the system's own dashed
   "nothing here" card in `main.css` and it would win the flex direction. */
.d-pick-btn.unset .d-pick-name { color: var(--muted); }

.d-pick-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.d-pick-chevron { flex-shrink: 0; margin-left: auto; color: var(--muted); }

/* ---- the lines ---------------------------------------------------------- */

.d-lines {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  overflow: hidden;
}

/**
 * The whole line is the target, exactly as a row on *Stanje šanka* is: a remove
 * button on the right would be a 44 px control taking the width the amount
 * needs, and correcting a mistyped quantity would still have nowhere to happen.
 * Both live in the sheet the line opens.
 */
.d-line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: baseline;
  gap: 4px 14px;
  width: 100%;
  min-height: var(--tap);
  padding: 10px 14px;
  border: 0;
  border-bottom: 1px solid var(--line-soft);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}

.d-line:last-child { border-bottom: 0; }
.d-line:active { background: var(--bg); }
.d-line:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

.d-line-name {
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--ink);
  min-width: 0;
}

.d-line-qty { font-size: var(--text-label); color: var(--muted); white-space: nowrap; }
.d-line-cost { font-size: var(--text-body); font-weight: 600; white-space: nowrap; }

.d-empty {
  margin: 0;
  padding: 20px 16px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-card);
  color: var(--muted);
  font-size: var(--text-label);
  text-align: center;
}

/* ---- the foot ----------------------------------------------------------- */

/**
 * One step down the surface ladder from the card, so the block that concludes
 * the document reads as a different job from the block that fills it — the same
 * move the dashboard's attention list makes with its flags (DESIGN §8).
 */
.d-foot {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--bg);
}

.d-foot-title {
  margin: 0;
  font-size: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
}

/* Two fields now that *Dobavljač* is gone: the date and what the paper says. */
.d-foot-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}

.d-total { display: flex; align-items: baseline; gap: 10px; }

.d-total-label {
  font-size: var(--text-label);
  color: var(--muted);
  margin-right: auto;
}

.d-total strong {
  font-family: var(--font-display);
  font-size: var(--text-metric);
  font-weight: 700;
}

.d-warn {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-field);
  background: var(--warn-soft);
  color: var(--warn);
  font-size: var(--text-label);
  font-weight: 500;
}

.d-send { display: flex; }

/* A disabled <button> swallows its own clicks without letting them bubble, so
   the wrapper around *Proknjiži* would never hear one. Taking the button out of
   hit-testing lets the click land on the wrapper, which is what turns the list
   of reasons on for somebody asking why the button is grey. */
.d-send > :deep(button:disabled) { pointer-events: none; }

.d-problems { margin: 0; padding-left: 18px; color: var(--muted); font-size: var(--text-micro); }
.d-error { margin: 0; color: var(--danger); font-size: var(--text-label); }
.d-ok { margin: 0; color: var(--good); font-size: var(--text-label); font-weight: 500; }

@media (max-width: 1023px) {
  /* One field per row: three inputs side by side on a 390 px screen is three
     fields too narrow to read the label of. */
  .d-add { grid-template-columns: 1fr; }
  .d-foot-fields { grid-template-columns: 1fr; }
  /* The two buttons this card is about take the width of the thumb. */
  .d-add-act > :deep(.a-btn),
  .d-send > :deep(.a-btn) { flex-grow: 1; }
  .d-add-act, .d-send { display: flex; }
}
</style>
