<script setup lang="ts">
/**
 * One stock article, as a form — the only one in the app.
 *
 * Two screens create or edit an article and both draw this sheet:
 *
 * - *Artikli zalihe* (`/admin/roba/artikli`) with `full`: every field the
 *   owner may set, for a new article or an existing one.
 * - *Prijem robe*, from the article picker, **short**: an unknown article is on
 *   the bar and the owner has a delivery note in his hand, so the sheet asks only
 *   what the delivery needs — name, category, vrsta, cost.
 *
 * **Vrsta is one choice, not two selects** (the owner, 16.09.2026): an article
 * is *Po komadu*, *Kafa (grami)* or *Okus za nargilu (grami)*, and that decides
 * both its `kind` and its unit. **The category is asked on both forms and is
 * required on a new article**: *Stanje šanka*, *Prijem robe* and *Meni* are one
 * list by one set of categories, and an article with none is on none of them.
 *
 * **Minimalna zaliha is required, on both forms**, in the article's own unit
 * (pieces, or grams for coffee and aromas): *Stanje šanka* turns the row red
 * when the shelf reaches it.
 *
 * **There is no *Brend* and no *Tolerancija popisa*** (the owner, 16.09.2026:
 * "tolerancija nam ne treba nikako"). Both columns stay on the row and are
 * simply not asked any more; a save sends neither, so nothing is cleared by
 * accident.
 *
 * **The sheet writes nothing.** It emits a body and the screen that opened it
 * does the write, because the writes differ (the typed delivery picks the new
 * article onto its document) and the form does not.
 *
 * **The cost is mandatory on a new article** (422 `COST_REQUIRED`): a zero cost
 * quietly turns *manjak*, *utrošak* and waste values into zeroes. It is typed as
 * the price of one piece (or a kilogram / litre) — see `app/utils/stockCost.ts`.
 *
 * **There is no pack field.** The owner's call: admins type every quantity in
 * the base unit. Every save sends `pack_name: null, pack_qty: null`, so an old
 * article that still says "gajba · 24" on the server is cleaned the next time it
 * is saved.
 *
 * **The unit is frozen once the article has a movement** (409 `UNIT_FROZEN`):
 * on hand is a sum over the ledger in the old unit. The select is disabled then,
 * and the server's refusal is still shown if a stale list let one through.
 */
import type { CategoryAdmin, StockItemAdmin } from '#shared/types'
import {
  ARTICLE_VRSTA_OPTIONS, type ArticleVrsta, isLogistika as isLogistikaName, kindAndUnitOf, vrstaOf,
} from '~/utils/stockCost'
import type { CreateStockItemBody, UpdateStockItemBody } from '#shared/schemas'

const props = withDefaults(defineProps<{
  open: boolean
  /** `null` creates a new article. */
  item?: StockItemAdmin | null
  /** Every field, not the delivery's short form. */
  full?: boolean
  /** For the category select — on both forms. */
  categories?: CategoryAdmin[]
  /** What a new article's name starts as: the picker's query. */
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

const vrsta = computed(() => vrstaOf(kind.value, baseUnit.value))

function setVrsta(value: ArticleVrsta) {
  const next = kindAndUnitOf(value, kind.value)
  // A unit the ledger already sums in cannot move; the choice is disabled then,
  // and this is the belt to that braces.
  if (unitFrozen.value && next.base_unit !== baseUnit.value) return
  kind.value = next.kind
  baseUnit.value = next.base_unit
}
/** In feninga, for `basis.qty` base units — not the stored per-unit cost. */
const costFen = ref<number | null>(null)
const categoryId = ref('')
const countMethod = ref<'count' | 'weigh'>('count')
const tareG = ref<number | null>(null)
const parQty = ref<number | null>(null)
const active = ref(true)

const basis = computed(() => costBasis(baseUnit.value))

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
  categoryId.value = item?.category_id ?? ''
  countMethod.value = item?.count_method ?? 'count'
  tareG.value = item?.tare_g ?? null
  parQty.value = item?.par_qty ?? null
  active.value = item?.active ?? true
  costFen.value = item && item.last_cost_mfen > 0
    ? fenFromMfen(item.last_cost_mfen, costBasis(item.base_unit).qty)
    : null
}, { immediate: true })

const categoryOptions = computed(() => {
  const listed = props.categories
    .filter(category => category.active || category.id === props.item?.category_id)
    .map(category => ({ value: category.id, label: category.name }))
  // A deleted category is no longer in the list, but the item still sits in it:
  // without its own option the select would show nothing and a save could
  // quietly drop the item out of its category.
  const own = props.item?.category_id
  const missing = own && !listed.some(option => option.value === own)
    ? [{ value: own, label: props.item?.category_name ?? 'Obrisana kategorija' }]
    : []
  // A new article must be put in a category; an old one may still sit in none.
  const none = props.item && !props.item.category_id
    ? [{ value: '', label: 'Bez kategorije' }]
    : [{ value: '', label: 'Izaberi kategoriju' }]
  return [...none, ...listed, ...missing]
})

const unitFrozen = computed(() => props.item?.unit_frozen ?? false)

/**
 * *Logistika* (the owner, 17.09.2026): transport, dostava — a cost with a name
 * and a price, not something on a shelf. The form asks only those two; the row
 * is a piece article with no minimum, so *Stanje šanka* never turns it red.
 */
const isLogistika = computed(() =>
  isLogistikaName(categoryOptions.value.find(option => option.value === categoryId.value)?.label))

watch(isLogistika, (logistika) => {
  if (!logistika) return
  if (!unitFrozen.value) {
    kind.value = 'potrosni'
    baseUnit.value = 'kom'
  }
  parQty.value = 0
  countMethod.value = 'count'
})

const canSave = computed(() =>
  name.value.trim().length > 0
  && (props.item !== null || (costFen.value ?? 0) > 0)
  && (props.item !== null || categoryId.value !== '')
  && parQty.value !== null && parQty.value >= 0
  && !props.pending)

function save() {
  if (!canSave.value) return
  const common = {
    name: name.value.trim(),
    kind: kind.value,
    category_id: categoryId.value || null,
    // Required on every article (the owner, 16.09.2026), so it is sent from
    // both forms and never as null.
    par_qty: parQty.value ?? 0,
    // No pack, ever — and on an edit this clears one an old row still holds.
    pack_name: null,
    pack_qty: null,
  }
  const extra = props.full
    ? {
        count_method: countMethod.value,
        tare_g: countMethod.value === 'weigh' ? tareG.value : null,
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
      :model-value="categoryId"
      label="Kategorija"
      kind="select"
      :options="categoryOptions"
      :hint="item ? undefined : 'Obavezno — ista kategorija je na stanju šanka, prijemu i meniju.'"
      @update:model-value="value => categoryId = String(value ?? '')"
    />
    <UiField
      v-if="!isLogistika"
      :model-value="vrsta"
      label="Vrsta"
      kind="select"
      :options="[...ARTICLE_VRSTA_OPTIONS]"
      :disabled="unitFrozen"
      :hint="unitFrozen ? 'Roba već ima promet — vrsta se više ne mijenja.' : 'Kafa, okusi i žar se vode u gramima, sve ostalo po komadu.'"
      @update:model-value="value => setVrsta(value as ArticleVrsta)"
    />

    <PostavkeNumField
      v-if="!isLogistika"
      label="Minimalna zaliha"
      :model-value="parQty"
      kind="decimal"
      :suffix="baseUnit"
      :hint="`Obavezno · u ${baseUnit === 'g' ? 'gramima' : 'komadima'} — kad stanje dođe do ovoga, pocrveni.`"
      @input="value => parQty = value"
      @commit="value => parQty = value"
    />

    <PostavkeNumField
      :label="isLogistika ? 'Cijena' : 'Nabavna cijena'"
      :model-value="costFen"
      kind="money"
      suffix="KM"
      :hint="`Cijena ${basis.label}${item ? '' : ' · obavezno'}`"
      @input="value => costFen = value"
      @commit="value => costFen = value"
    />

    <template v-if="full && !isLogistika">

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
