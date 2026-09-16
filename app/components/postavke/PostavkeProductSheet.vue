<script setup lang="ts">
/**
 * *Novi artikal* — the only form on *Meni* that is submitted as a whole.
 *
 * Everything else on that page saves field by field, but a product does not
 * exist until it has a category, a name and a price, so those three arrive
 * together. The price opens the product's first `price_history` row in the same
 * transaction, which is why "what did this cost in March" has an answer from the
 * first minute.
 *
 * **What it takes off the shelf is chosen here too** (the owner, 16.09.2026):
 * *Po komadu* an article of *Stanje šanka*, *Troši kafu*, *Nargila*, or *Ne
 * oduzima*. Picking a shelf article with the name still empty names the menu
 * article after it — the menu shows the shelf's articles by their own names.
 */
import type { CategoryAdmin, StockItemAdmin } from '#shared/types'
import type { CreateProductBody } from '#shared/schemas'
import { zalihaPatch, zalihaReady, type ZalihaMode } from '~/utils/menuZaliha'

const props = withDefaults(defineProps<{
  open: boolean
  categories: CategoryAdmin[]
  /** *Stanje šanka*, for *Oduzima sa stanja*. */
  items?: StockItemAdmin[]
  pending: boolean
  error: string | null
}>(), { items: () => [] })

const emit = defineEmits<{ close: [], save: [body: CreateProductBody] }>()

const categoryId = ref('')
const name = ref('')
const shortName = ref('')
const priceFen = ref<number | null>(null)
const mode = ref<ZalihaMode>('komad')
const articleId = ref<string | null>(null)
const staffDrink = ref(false)

/** Name the menu article after the shelf article, while nobody has typed one. */
watch(articleId, (id) => {
  if (!id || name.value.trim() !== '') return
  const item = props.items.find(row => row.id === id)
  if (item) name.value = item.name.slice(0, 60)
})

const categoryOptions = computed(() => props.categories
  .filter(category => category.active)
  .map(category => ({ value: category.id, label: category.name })))

watch(() => props.open, (open) => {
  if (!open) return
  categoryId.value = categoryOptions.value[0]?.value ?? ''
  name.value = ''
  shortName.value = ''
  priceFen.value = null
  mode.value = 'komad'
  articleId.value = null
  staffDrink.value = false
})

const canSave = computed(() =>
  categoryId.value !== '' && name.value.trim() !== '' && priceFen.value !== null
  && zalihaReady(mode.value, articleId.value))

function save() {
  if (!canSave.value) return
  emit('save', {
    category_id: categoryId.value,
    name: name.value.trim(),
    short_name: shortName.value.trim() || null,
    price_fen: priceFen.value as number,
    ...zalihaPatch(mode.value, articleId.value),
    staff_drink_allowed: staffDrink.value,
  })
}
</script>

<template>
  <UiSheet
    :open="open"
    title="Novi artikal"
    :pending="pending"
    @close="emit('close')"
  >
    <p v-if="error" class="p-error" role="alert">{{ error }}</p>

    <UiField
      v-model="categoryId"
      label="Kategorija"
      kind="select"
      :options="categoryOptions"
    />
    <UiField v-model="name" label="Naziv" placeholder="Limunada" />
    <UiField v-model="shortName" label="Kratki naziv" placeholder="Limun." />

    <PostavkeNumField
      label="Cijena"
      :model-value="priceFen"
      kind="money"
      suffix="KM"
      @commit="value => priceFen = value"
      @input="value => priceFen = value"
    />

    <PostavkeZalihaFields
      v-model:mode="mode"
      v-model:article-id="articleId"
      :items="items"
      :category-id="categoryId"
    />

    <div class="p-seg-row">
      <span class="p-caption">Piće za osoblje</span>
      <PostavkeToggle v-model="staffDrink" label="Piće za osoblje" words />
    </div>

      <template #footer>
        <UiButton variant="ghost" @click="emit('close')">Odustani</UiButton>
        <UiButton
          variant="primary"
          :pending="pending"
          :disabled="!canSave"
          @click="save"
        >Dodaj</UiButton>
      </template>
  </UiSheet>
</template>

<style scoped>
.p-error {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: var(--text-micro);
}

.p-seg-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }

.p-caption {
  font-size: var(--text-caption);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  font-weight: 600;
}

.p-note { margin: 0; color: var(--muted); font-size: var(--text-micro); }
</style>
