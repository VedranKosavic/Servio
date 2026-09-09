<script setup lang="ts">
/**
 * *Novi artikal* — the only form on *Meni* that is submitted as a whole.
 *
 * Everything else on that page saves field by field, but a product does not
 * exist until it has a category, a name and a price, so those three arrive
 * together. The price opens the product's first `price_history` row in the same
 * transaction, which is why "what did this cost in March" has an answer from the
 * first minute.
 */
import type { CategoryAdmin } from '#shared/types'
import type { CreateProductBody } from '#shared/schemas'

const props = defineProps<{
  open: boolean
  categories: CategoryAdmin[]
  pending: boolean
  error: string | null
}>()

const emit = defineEmits<{ close: [], save: [body: CreateProductBody] }>()

const categoryId = ref('')
const name = ref('')
const shortName = ref('')
const priceFen = ref<number | null>(null)
const kind = ref<'simple' | 'shisha'>('simple')
const shishaGrams = ref<number | null>(null)
const coalPcs = ref<number | null>(null)
const staffDrink = ref(false)

const categoryOptions = computed(() => props.categories
  .filter(category => category.active)
  .map(category => ({ value: category.id, label: category.name })))

watch(() => props.open, (open) => {
  if (!open) return
  categoryId.value = categoryOptions.value[0]?.value ?? ''
  name.value = ''
  shortName.value = ''
  priceFen.value = null
  kind.value = 'simple'
  shishaGrams.value = null
  coalPcs.value = null
  staffDrink.value = false
})

const canSave = computed(() =>
  categoryId.value !== '' && name.value.trim() !== '' && priceFen.value !== null)

function save() {
  if (!canSave.value) return
  emit('save', {
    category_id: categoryId.value,
    name: name.value.trim(),
    short_name: shortName.value.trim() || null,
    price_fen: priceFen.value as number,
    kind: kind.value,
    ...(kind.value === 'shisha'
      ? { shisha_grams: shishaGrams.value, coal_pcs: coalPcs.value }
      : {}),
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

    <div class="p-seg-row">
      <span class="p-caption">Vrsta</span>
      <UiSeg
        :model-value="kind"
        label="Vrsta artikla"
        :options="[
          { value: 'simple', label: 'Obično' },
          { value: 'shisha', label: 'Nargila' },
        ]"
        @update:model-value="value => kind = value as 'simple' | 'shisha'"
      />
    </div>

    <template v-if="kind === 'shisha'">
      <PostavkeNumField
        label="Grama po luli"
        :model-value="shishaGrams"
        kind="decimal"
        suffix="g"
        hint="Prazno znači da se uzima vrijednost iz Podešavanja."
        @commit="value => shishaGrams = value"
      />
      <PostavkeNumField
        label="Žara po luli"
        :model-value="coalPcs"
        kind="int"
        suffix="kom"
        @commit="value => coalPcs = value"
      />
    </template>

    <div class="p-seg-row">
      <span class="p-caption">Piće za osoblje</span>
      <PostavkeToggle v-model="staffDrink" label="Piće za osoblje" words />
    </div>

    <p class="p-note">Normativ se dodaje nakon što artikal postoji.</p>
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
  font-size: 13px;
}

.p-seg-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }

.p-caption {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  font-weight: 600;
}

.p-note { margin: 0; color: var(--muted); font-size: 13px; }
</style>
