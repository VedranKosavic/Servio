<script setup lang="ts">
/**
 * The *normativ* — how much of each shelf item one sale of this product takes
 * off the bar.
 *
 * It is saved **whole**, with one `PUT`: a recipe is one statement about a
 * product ("kafa is 7 g kafe and 5 g šećera"), and saving it line by line is how
 * a product ends up briefly consuming sugar and nothing else. So the sheet edits
 * a local copy and sends the finished set; closing it without saving changes
 * nothing.
 *
 * A product with no lines here consumes nothing when it is sold, which is what
 * the *bez normativa* mark on the row means — legitimate for "Dodatni žar" and
 * a mistake for "Kafa".
 */
import type { ProductAdmin, StockItemAdmin } from '#shared/types'

/** One line as it is being edited: the item may still be unchosen. */
interface DraftLine {
  stock_item_id: string
  /** The raw number; `null` while the field is empty. */
  qty: number | null
}

const props = defineProps<{
  open: boolean
  product: ProductAdmin | null
  /** The catalogue the lines point at — `GET /api/admin/stock-items`. */
  items: StockItemAdmin[]
  pending: boolean
  error: string | null
}>()

const emit = defineEmits<{
  close: []
  save: [lines: Array<{ stock_item_id: string, qty: number }>]
}>()

/** The schema's ceiling; a recipe longer than this is a different problem. */
const MAX_LINES = 20

const lines = ref<DraftLine[]>([])

// Re-seed from the product each time the sheet opens, so a cancel really is a
// cancel and yesterday's half-edit does not reappear on the next product.
watch(() => [props.open, props.product?.id], () => {
  if (!props.open || !props.product) return
  lines.value = props.product.recipe.map(line => ({
    stock_item_id: line.stock_item_id,
    qty: line.qty,
  }))
}, { immediate: true })

const options = computed(() => props.items
  .filter(item => item.active)
  .map(item => ({ value: item.id, label: `${item.name} (${item.base_unit})` })))

function unitOf(id: string): string {
  return props.items.find(item => item.id === id)?.base_unit ?? ''
}

function addLine() {
  if (lines.value.length >= MAX_LINES) return
  lines.value.push({ stock_item_id: options.value[0]?.value ?? '', qty: null })
}

function removeLine(index: number) {
  lines.value.splice(index, 1)
}

/** The same item twice is a 422 from the server; say so before sending. */
const duplicate = computed(() => {
  const seen = new Set<string>()
  for (const line of lines.value) {
    if (seen.has(line.stock_item_id)) return true
    seen.add(line.stock_item_id)
  }
  return false
})

const incomplete = computed(() =>
  lines.value.some(line => !line.stock_item_id || line.qty === null || line.qty <= 0))

const canSave = computed(() => !duplicate.value && !incomplete.value)

function save() {
  if (!canSave.value) return
  emit('save', lines.value.map(line => ({
    stock_item_id: line.stock_item_id,
    qty: line.qty as number,
  })))
}
</script>

<template>
  <UiSheet
    :open="open"
    :title="product ? `Normativ · ${product.name}` : 'Normativ'"
    :pending="pending"
    @close="emit('close')"
  >
    <p class="p-note">
      Koliko robe jedna prodaja skine sa šanka. Prazan normativ znači da se
      prodajom ništa ne troši.
    </p>

    <p v-if="error" class="p-error" role="alert">{{ error }}</p>
    <p v-else-if="duplicate" class="p-error" role="alert">Ista roba je dva puta u normativu.</p>

    <div v-if="lines.length" class="p-lines">
      <div class="p-lines-head">
        <span>Roba</span>
        <span>Količina</span>
        <span />
      </div>

      <div v-for="(line, index) in lines" :key="index" class="p-line">
        <PostavkeSelect
          v-model="line.stock_item_id"
          :options="options"
          :label="`Roba, ${index + 1}. stavka`"
        />
        <PostavkeNum
          :model-value="line.qty"
          kind="decimal"
          :label="`Količina, ${index + 1}. stavka`"
          :suffix="unitOf(line.stock_item_id)"
          width="96px"
          @commit="value => line.qty = value"
          @input="value => line.qty = value"
        />
        <UiButton small variant="danger" @click="removeLine(index)">
          <UiIcon name="x" :size="18" />
          <span class="p-sr">Ukloni stavku</span>
        </UiButton>
      </div>
    </div>

    <p v-else class="p-empty">Nema normativa — prodaja ovog artikla ne skida robu.</p>

    <UiButton
      variant="soft"
      :disabled="lines.length >= MAX_LINES || options.length === 0"
      @click="addLine"
    >Dodaj stavku</UiButton>
      <template #footer>
        <UiButton variant="ghost" @click="emit('close')">Odustani</UiButton>
        <UiButton
          variant="primary"
          :pending="pending"
          :disabled="!canSave"
          @click="save"
        >Sačuvaj normativ</UiButton>
      </template>
  </UiSheet>
</template>

<style scoped>
.p-note { margin: 0; color: var(--muted); font-size: 13px; }

.p-error {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 13px;
}

.p-lines { display: flex; flex-direction: column; gap: 8px; }

.p-lines-head,
.p-line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
}

.p-lines-head span {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  font-weight: 600;
}

.p-empty { margin: 0; color: var(--muted); font-size: 14px; }

/* Visible to a screen reader, invisible on screen — the icon buttons' names. */
.p-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
