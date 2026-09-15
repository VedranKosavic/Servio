<script setup lang="ts">
/**
 * One stock article, as a form — the only one in the app.
 *
 * Three screens create or edit an article and all three draw this sheet:
 *
 * - *Artikli zalihe* (`/admin/kontrola/artikli`) with `full`: every field the
 *   owner may set, for a new article or an existing one.
 * - *Prijem robe*, from the article picker, **short**: an unknown crate is on the
 *   bar and the owner has a delivery note in his hand, so the sheet asks only
 *   what the delivery needs — name, kind, unit, pack, cost.
 * - *Prijem sa slike* (`RobaScanNoviArtikal`), short, which also learns the OCR
 *   text as an alias after the article exists.
 *
 * **The sheet writes nothing.** It emits a body and the screen that opened it
 * does the write, because the three writes differ (the photo flow links an alias,
 * the typed delivery picks the new article onto its document) and the form does
 * not.
 *
 * **The cost is mandatory on a new article** (422 `COST_REQUIRED`): a zero cost
 * quietly turns *manjak*, *utrošak* and waste values into zeroes. It is typed as
 * the price of what the invoice prices — see `app/utils/stockCost.ts`.
 *
 * **The unit is frozen once the article has a movement** (409 `UNIT_FROZEN`):
 * on hand is a sum over the ledger in the old unit. The select is disabled then,
 * and the server's refusal is still shown if a stale list let one through.
 */
import type { CategoryAdmin, StockItemAdmin } from '#shared/types'
import type { CreateStockItemBody, UpdateStockItemBody } from '#shared/schemas'

const props = withDefaults(defineProps<{
  open: boolean
  /** `null` creates a new article. */
  item?: StockItemAdmin | null
  /** Every field, not the delivery's short form. */
  full?: boolean
  /** For the category select in the full form. */
  categories?: CategoryAdmin[]
  /** What a new article's name starts as: the picker's query, the OCR text. */
  initialName?: string
  /** The primary button. */
  action?: string
  pending?: boolean
  error?: string | null
}>(), { item: null, full: false, categories: () => [], initialName: '', action: 'Sačuvaj', pending: false, error: null })

const emit = defineEmits<{
  close: []
  create: [body: CreateStockItemBody]
  update: [id: string, patch: UpdateStockItemBody]
}>()

const name = ref('')
const kind = ref<CreateStockItemBody['kind']>('pice')
const baseUnit = ref<CreateStockItemBody['base_unit']>('kom')
const packName = ref('')
const packQty = ref<number | null>(null)
/** In feninga, for `basis.qty` base units — not the stored per-unit cost. */
const costFen = ref<number | null>(null)
const categoryId = ref('')
const brand = ref('')
const countMethod = ref<'count' | 'weigh'>('count')
const tareG = ref<number | null>(null)
const toleranceQty = ref<number | null>(null)
const parQty = ref<number | null>(null)
const active = ref(true)

const basis = computed(() => costBasis(baseUnit.value, packName.value, packQty.value))

/** The cost as the item stood when the sheet opened, at the basis now on screen. */
const originalCostFen = computed(() =>
  props.item && props.item.last_cost_mfen > 0
    ? fenFromMfen(props.item.last_cost_mfen, basis.value.qty)
    : null)

watch(() => props.open, (open) => {
  if (!open) return
  const item = props.item
  name.value = item?.name ?? props.initialName.slice(0, 60)
  kind.value = item?.kind ?? 'pice'
  baseUnit.value = item?.base_unit ?? 'kom'
  packName.value = item?.pack_name ?? ''
  packQty.value = item?.pack_qty ?? null
  categoryId.value = item?.category_id ?? ''
  brand.value = item?.brand ?? ''
  countMethod.value = item?.count_method ?? 'count'
  tareG.value = item?.tare_g ?? null
  toleranceQty.value = item?.tolerance_qty ?? null
  parQty.value = item?.par_qty ?? null
  active.value = item?.active ?? true
  costFen.value = item && item.last_cost_mfen > 0
    ? fenFromMfen(item.last_cost_mfen, costBasis(item.base_unit, item.pack_name, item.pack_qty).qty)
    : null
}, { immediate: true })

const categoryOptions = computed(() => [
  { value: '', label: 'Bez kategorije' },
  ...props.categories
    .filter(category => category.active || category.id === props.item?.category_id)
    .map(category => ({ value: category.id, label: category.name })),
])

const unitFrozen = computed(() => props.item?.unit_frozen ?? false)

const canSave = computed(() =>
  name.value.trim().length > 0
  && (props.item !== null || (costFen.value ?? 0) > 0)
  && !props.pending)

function save() {
  if (!canSave.value) return
  const pack = packName.value.trim() || null
  const common = {
    name: name.value.trim(),
    kind: kind.value,
    pack_name: pack,
    pack_qty: pack ? packQty.value : null,
  }
  const extra = props.full
    ? {
        category_id: categoryId.value || null,
        brand: brand.value.trim() || null,
        count_method: countMethod.value,
        tare_g: countMethod.value === 'weigh' ? tareG.value : null,
        tolerance_qty: toleranceQty.value ?? 0,
        par_qty: parQty.value,
      }
    : {}

  if (!props.item) {
    emit('create', {
      ...common,
      ...extra,
      base_unit: baseUnit.value,
      last_cost_mfen: mfenFromFen(costFen.value ?? 0, basis.value.qty),
    })
    return
  }

  // The cost goes only when it moved: re-deriving it from a rounded figure
  // would nudge the stored price by a milli-fening on every save.
  const costMoved = costFen.value !== null && costFen.value > 0
    && costFen.value !== originalCostFen.value
  emit('update', props.item.id, {
    ...common,
    ...extra,
    ...(baseUnit.value !== props.item.base_unit ? { base_unit: baseUnit.value } : {}),
    ...(costMoved ? { last_cost_mfen: mfenFromFen(costFen.value!, basis.value.qty) } : {}),
    active: active.value,
  })
}
</script>

<template>
  <UiSheet
    :open="open"
    :title="item ? item.name : 'Novi artikal'"
    :pending="pending"
    @close="emit('close')"
    @confirm="save"
  >
    <slot name="lead" />

    <p v-if="error" class="s-error" role="alert">{{ error }}</p>

    <UiField v-model="name" label="Naziv" placeholder="Npr. Coca-Cola 0,25" />
    <UiField
      :model-value="kind"
      label="Vrsta"
      kind="select"
      :options="[...STOCK_KIND_OPTIONS]"
      @update:model-value="value => kind = value as CreateStockItemBody['kind']"
    />
    <UiField
      :model-value="baseUnit"
      label="Osnovna jedinica"
      kind="select"
      :options="[...BASE_UNIT_OPTIONS]"
      :disabled="unitFrozen"
      :hint="unitFrozen ? 'Roba već ima promet — jedinica se više ne mijenja.' : undefined"
      @update:model-value="value => baseUnit = value as CreateStockItemBody['base_unit']"
    />

    <div class="s-pair">
      <UiField v-model="packName" label="Naziv paketa" placeholder="gajba, kutija" />
      <PostavkeNumField
        :label="`Količina u paketu (${baseUnit})`"
        :model-value="packQty"
        kind="decimal"
        :disabled="packName.trim() === ''"
        @input="value => packQty = value"
        @commit="value => packQty = value"
      />
    </div>
    <p class="s-muted">Prazno ako roba ne dolazi u paketu.</p>

    <PostavkeNumField
      label="Nabavna cijena"
      :model-value="costFen"
      kind="money"
      suffix="KM"
      :hint="`Cijena za: ${basis.label}${item ? '' : ' · obavezno'}`"
      @input="value => costFen = value"
      @commit="value => costFen = value"
    />

    <template v-if="full">
      <UiField
        :model-value="categoryId"
        label="Kategorija"
        kind="select"
        :options="categoryOptions"
        @update:model-value="value => categoryId = String(value ?? '')"
      />
      <UiField v-model="brand" label="Brend" placeholder="Neobavezno" />

      <div class="s-row">
        <span class="s-caption">Popis</span>
        <UiSeg
          :model-value="countMethod"
          label="Kako se popisuje"
          :options="[
            { value: 'count', label: 'Broji se' },
            { value: 'weigh', label: 'Mjeri se na vagi' },
          ]"
          @update:model-value="value => countMethod = value as 'count' | 'weigh'"
        />
      </div>

      <PostavkeNumField
        v-if="countMethod === 'weigh'"
        label="Tara (prazna posuda)"
        :model-value="tareG"
        kind="decimal"
        suffix="g"
        @input="value => tareG = value"
        @commit="value => tareG = value"
      />

      <div class="s-pair">
        <PostavkeNumField
          label="Tolerancija popisa"
          :model-value="toleranceQty"
          kind="decimal"
          :suffix="baseUnit"
          hint="Razlika do ove količine nije manjak."
          @input="value => toleranceQty = value"
          @commit="value => toleranceQty = value"
        />
        <PostavkeNumField
          label="Minimalna zaliha"
          :model-value="parQty"
          kind="decimal"
          :suffix="baseUnit"
          hint="Neobavezno"
          @input="value => parQty = value"
          @commit="value => parQty = value"
        />
      </div>

      <div v-if="item" class="s-row">
        <span class="s-caption">Aktivan</span>
        <PostavkeToggle v-model="active" label="Aktivan" words />
        <span class="s-muted s-grow">
          {{ active ? 'Nudi se na prijemu i popisu.' : 'Ne nudi se nigdje, a promet ostaje.' }}
        </span>
      </div>
    </template>

    <slot name="note" />

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Odustani</UiButton>
      <UiButton variant="primary" :disabled="!canSave" :pending="pending" @click="save">
        {{ action }}
      </UiButton>
    </template>
  </UiSheet>
</template>

<style scoped>
.s-error {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--radius-field);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: var(--text-micro);
}

.s-muted { margin: 0; color: var(--muted); font-size: var(--text-micro); }

/* Two short fields side by side, one under the other on a narrow sheet. */
.s-pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

@media (max-width: 479px) {
  .s-pair { grid-template-columns: minmax(0, 1fr); }
}

.s-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; min-width: 0; }
.s-grow { flex: 1 1 160px; }

.s-caption {
  font-size: var(--text-caption);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  font-weight: 600;
}
</style>
