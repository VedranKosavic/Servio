<script setup lang="ts">
/**
 * *Meni* — the catalogue the waiter's phone draws its tiles from.
 *
 * One read (`GET /api/admin/products`) grouped by category, and every change
 * saves by itself: the price on blur, the switches on the click. There is no
 * Save button, because a menu is edited one line at a time.
 *
 * **A price change is history, not an edit.** The server closes the open
 * `price_history` row and opens a new one; the `order_lines` already locked
 * tonight keep the price the guest was actually charged. So correcting a price
 * at midnight does not move tonight's pazar — but it *does* move what the next
 * round costs, which is why the standing warning below says to do it before the
 * shift opens.
 */
import type { CategoryAdmin, ProductAdmin, StockItemAdmin } from '#shared/types'
import type { CreateProductBody, UpdateProductBody } from '#shared/schemas'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Meni' })

const api = useAdminApi()

/** The phone's *Omiljeno* tab holds twelve tiles; a thirteenth would not fit. */
const FAVOURITE_CAP = 12

const products = ref<ProductAdmin[]>([])
const categories = ref<CategoryAdmin[]>([])
const stockItems = ref<StockItemAdmin[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

/** Which row has a write in flight — so its own controls grey out, not the page. */
const busyId = ref<string | null>(null)

const show = ref<'aktivni' | 'svi'>('aktivni')
const search = ref('')

const recipeFor = ref<ProductAdmin | null>(null)
const recipePending = ref(false)
const recipeError = ref<string | null>(null)

const newOpen = ref(false)
const newPending = ref(false)
const newError = ref<string | null>(null)

async function load() {
  try {
    const [list, cats, items] = await Promise.all([
      api.getProducts(), api.getAdminCategories(), api.getStockItems(),
    ])
    products.value = list
    categories.value = cats
    stockItems.value = items
    error.value = null
  } catch (err) {
    error.value = apiErrorText(err, 'Meni se nije učitao.')
  } finally {
    loading.value = false
  }
}

onMounted(() => { void load() })

// One poll for the whole dashboard. The menu goes stale when somebody else's
// laptop changes a price, so refetch on `menu` and on nothing else.
useAdminChanges({
  onEntity: (entity) => { if (entity === 'menu') void load() },
})

const favouriteCount = computed(() =>
  products.value.filter(product => product.is_favourite).length)

const visible = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return products.value.filter((product) => {
    if (show.value === 'aktivni' && !product.active) return false
    if (!needle) return true
    return product.name.toLowerCase().includes(needle)
      || (product.short_name ?? '').toLowerCase().includes(needle)
  })
})

/** The categories that still have a visible product, in the menu's own order. */
const groups = computed(() => categories.value
  .map(category => ({
    category,
    rows: visible.value.filter(product => product.category_id === category.id),
  }))
  .filter(group => group.rows.length > 0))

const columns = [
  { key: 'artikal', label: 'Artikal' },
  { key: 'cijena', label: 'Cijena', align: 'r' as const, width: '150px' },
  { key: 'grami', label: 'g / lula', align: 'r' as const, width: '130px' },
  { key: 'omiljeno', label: 'Omiljeno', width: '90px' },
  { key: 'aktivan', label: 'Aktivan', width: '90px' },
  { key: 'osoblje', label: 'Osoblje', width: '90px' },
  { key: 'normativ', label: 'Normativ', align: 'r' as const, width: '130px' },
]

async function patch(product: ProductAdmin, body: UpdateProductBody) {
  busyId.value = product.id
  try {
    const fresh = await api.updateProduct(product.id, body)
    const index = products.value.findIndex(row => row.id === product.id)
    if (index >= 0) products.value[index] = fresh
    error.value = null
  } catch (err) {
    // Re-read first, so the screen never shows a value the server refused —
    // then set the sentence, because `load()` clears it on a good read.
    await load()
    error.value = apiErrorText(err, 'Izmjena nije snimljena.')
  } finally {
    busyId.value = null
  }
}

async function saveRecipe(lines: Array<{ stock_item_id: string, qty: number }>) {
  const product = recipeFor.value
  if (!product) return
  recipePending.value = true
  try {
    await api.setRecipe(product.id, { lines })
    recipeError.value = null
    recipeFor.value = null
    await load()
  } catch (err) {
    recipeError.value = apiErrorText(err, 'Normativ nije snimljen.')
  } finally {
    recipePending.value = false
  }
}

async function createProduct(body: CreateProductBody) {
  newPending.value = true
  try {
    await api.createProduct(body)
    newError.value = null
    newOpen.value = false
    await load()
  } catch (err) {
    newError.value = apiErrorText(err, 'Artikal nije dodan.')
  } finally {
    newPending.value = false
  }
}
</script>

<template>
  <PostavkePage
    title="Meni"
    sub="Cijene, omiljeno i normativi"
    :error="error"
  >
    <template #actions>
      <UiButton variant="primary" @click="newOpen = true">Novi artikal</UiButton>
    </template>

    <p class="p-warn">
      Mijenjaj cijene prije otvaranja smjene — već zaključene ture zadržavaju
      cijenu po kojoj su naplaćene.
    </p>

    <div class="p-filters">
      <UiSeg
        :model-value="show"
        label="Koji artikli"
        :options="[{ value: 'aktivni', label: 'Aktivni' }, { value: 'svi', label: 'Svi' }]"
        @update:model-value="value => show = value as 'aktivni' | 'svi'"
      />
      <input
        v-model="search"
        class="p-search"
        type="search"
        placeholder="Traži artikal"
        aria-label="Traži artikal"
      >
      <span class="p-fav-count">
        Omiljeno {{ favouriteCount }} / {{ FAVOURITE_CAP }}
      </span>
    </div>

    <UiCard v-if="loading" title="Meni">
      <UiTable :columns="columns" loading />
    </UiCard>

    <UiCard
      v-for="group in groups"
      :key="group.category.id"
      :title="group.category.name"
      :count="`${group.rows.length}`"
    >
      <UiTable :columns="columns">
        <PostavkeProductRow
          v-for="product in group.rows"
          :key="product.id"
          :product="product"
          :favourite-full="favouriteCount >= FAVOURITE_CAP"
          :pending="busyId === product.id"
          @patch="body => patch(product, body)"
          @recipe="recipeFor = product; recipeError = null"
        />
      </UiTable>
    </UiCard>

    <UiCard v-if="!loading && groups.length === 0">
      <p class="p-empty">Nema artikala po ovoj pretrazi.</p>
    </UiCard>

    <PostavkeRecipeEditor
      :open="recipeFor !== null"
      :product="recipeFor"
      :items="stockItems"
      :pending="recipePending"
      :error="recipeError"
      @close="recipeFor = null"
      @save="saveRecipe"
    />

    <PostavkeProductSheet
      :open="newOpen"
      :categories="categories"
      :pending="newPending"
      :error="newError"
      @close="newOpen = false"
      @save="createProduct"
    />
  </PostavkePage>
</template>

<style scoped>
.p-warn {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--warn-soft);
  color: var(--warn);
  font-size: var(--text-label);
  font-weight: 500;
}

.p-filters { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }

.p-search {
  height: 36px;
  flex-grow: 1;
  min-width: 160px;
  max-width: 280px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--field-bg);
  padding: 0 12px;
  font: inherit;
  font-size: var(--text-label);
  color: var(--ink);
}

.p-search:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.p-fav-count {
  font-size: var(--text-micro);
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  margin-left: auto;
}

.p-empty { margin: 0; color: var(--muted); }

@media (max-width: 1023px) {
  .p-search { height: 44px; font-size: var(--text-section); max-width: none; }
  .p-fav-count { margin-left: 0; font-size: var(--text-label); }
}
</style>
