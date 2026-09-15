<script setup lang="ts">
/**
 * *Artikli zalihe* — what the bar stocks, as the owner edits it.
 *
 * Not *Meni*: a product is what a guest orders, a stock article is what sits on
 * the shelf and is counted, delivered and written off. This screen creates one,
 * edits one, and takes one off the shelf — **never deletes one**, because its
 * movements are the ledger and a movement whose article stops resolving is a
 * *Stanje šanka* that silently loses a row. So the way out is *Aktivan* off, and
 * deactivated articles wait behind a fold at both widths, like *Osoblje*.
 *
 * Every write is the existing `POST` / `PATCH /api/admin/stock-items`, so the
 * server's two rules still hold here: a new article needs a cost (422
 * `COST_REQUIRED`) and the unit is frozen once it has a movement (409
 * `UNIT_FROZEN`). Both come back as Bosnian sentences through `apiErrorText`.
 *
 * Two layouts, one page, gated on `useMounted()` exactly as `osoblje.vue`
 * explains: a table at a desk, a list with the sheet under 1024 px.
 */
import type { CategoryAdmin, StockItemAdmin } from '#shared/types'
import type { CreateStockItemBody, UpdateStockItemBody } from '#shared/schemas'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Artikli zalihe' })

const api = useAdminApi()

const mounted = useMounted()
const narrow = useMediaQuery('(max-width: 1023px)')
const isPhone = computed(() => mounted.value && narrow.value)

const items = ref<StockItemAdmin[]>([])
const categories = ref<CategoryAdmin[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const activeItems = computed(() => items.value.filter(item => item.active))
const retired = computed(() => items.value.filter(item => !item.active))

const show = ref<'aktivni' | 'svi'>('aktivni')
const rows = computed(() => (show.value === 'svi'
  ? [...activeItems.value, ...retired.value]
  : activeItems.value))

async function load() {
  try {
    const [list, cats] = await Promise.all([api.getStockItems(), api.getAdminCategories()])
    items.value = list
    categories.value = cats
    error.value = null
  } catch (err) {
    error.value = apiErrorText(err, 'Artikli se nisu učitali.')
  } finally {
    loading.value = false
  }
}

onMounted(() => { void load() })

// `createStockItem` / `updateStockItem` bump `stock` (and `menu`); a delivery,
// a count or a korekcija moves `stock` too, which is what flips `unit_frozen`.
useAdminChanges({
  onEntity: (entity) => { if (entity === 'stock') void load() },
})

const columns = [
  { key: 'naziv', label: 'Naziv' },
  { key: 'vrsta', label: 'Vrsta', width: '100px' },
  { key: 'jedinica', label: 'Jedinica', width: '90px' },
  { key: 'cijena', label: 'Nabavna cijena', width: '220px' },
  { key: 'tolerancija', label: 'Tolerancija', width: '110px' },
  { key: 'stanje', label: 'Stanje', width: '100px' },
  { key: 'akcije', label: '', align: 'r' as const, width: '190px' },
]

// -- the sheet ---------------------------------------------------------------

/** By id, not by object: a poll replaces the row and the sheet must follow it. */
const editingId = ref<string | null>(null)
const sheetOpen = ref(false)
const sheetPending = ref(false)
const sheetError = ref<string | null>(null)

const editing = computed(() => items.value.find(item => item.id === editingId.value) ?? null)

function open(item: StockItemAdmin | null) {
  editingId.value = item?.id ?? null
  sheetError.value = null
  sheetOpen.value = true
}

async function create(body: CreateStockItemBody) {
  sheetPending.value = true
  try {
    await api.createStockItem(body)
    sheetOpen.value = false
    await load()
  } catch (err) {
    sheetError.value = apiErrorText(err, 'Artikal nije dodan.')
  } finally {
    sheetPending.value = false
  }
}

async function update(id: string, patch: UpdateStockItemBody) {
  sheetPending.value = true
  try {
    await api.updateStockItem(id, patch)
    sheetOpen.value = false
    await load()
  } catch (err) {
    sheetError.value = apiErrorText(err, 'Izmjena nije snimljena.')
  } finally {
    sheetPending.value = false
  }
}

// -- the laptop's one-tap switch ---------------------------------------------

const rowPending = ref<string | null>(null)

async function setActive(item: StockItemAdmin, active: boolean) {
  rowPending.value = item.id
  try {
    await api.updateStockItem(item.id, { active })
    error.value = null
    await load()
  } catch (err) {
    error.value = apiErrorText(err, active ? 'Artikal nije vraćen.' : 'Artikal nije ugašen.')
  } finally {
    rowPending.value = null
  }
}

function packText(item: StockItemAdmin): string {
  return item.pack_name && item.pack_qty ? `${item.pack_name} · ${item.pack_qty}` : ''
}
</script>

<template>
  <div class="k-page">
    <UiPageHead
      title="Artikli zalihe"
      sub="Jedinica, paket, nabavna cijena, tolerancija"
      :stale="error ?? undefined"
    >
      <template #actions>
        <UiButton variant="primary" @click="open(null)">Novi artikal</UiButton>
      </template>
    </UiPageHead>

    <!-- ---- the phone ------------------------------------------------- -->
    <RobaArtikliList
      v-if="isPhone"
      :items="activeItems"
      :retired="retired"
      :loading="loading"
      @open="open"
    />

    <!-- ---- the laptop ------------------------------------------------ -->
    <template v-else>
      <div class="k-filters">
        <UiSeg
          :model-value="show"
          label="Koji artikli"
          :options="[{ value: 'aktivni', label: 'Aktivni' }, { value: 'svi', label: 'Svi' }]"
          @update:model-value="value => show = value as 'aktivni' | 'svi'"
        />
        <span v-if="retired.length" class="k-off-count">
          Ugašeni · <span class="num">{{ retired.length }}</span>
        </span>
      </div>

      <UiCard title="Artikli zalihe" :count="rows.length">
        <UiTable :columns="columns" :loading="loading" empty="Nema artikala.">
          <tr v-for="item in rows" :key="item.id" :class="{ off: !item.active }">
            <td>
              <strong>{{ item.name }}</strong>
              <span v-if="item.brand" class="k-muted"> · {{ item.brand }}</span>
            </td>
            <td>{{ stockKindLabel(item.kind) }}</td>
            <td>
              {{ item.base_unit }}
              <span v-if="packText(item)" class="k-muted k-block">{{ packText(item) }}</span>
            </td>
            <td class="num">
              {{ stockCostText(item) }}
              <span v-if="item.estimated_cost && item.last_cost_mfen > 0" class="k-muted k-block">procijenjeno</span>
            </td>
            <td class="num">{{ formatStockQty(item.tolerance_qty, item.base_unit) }}</td>
            <td>
              <UiPill :tone="item.active ? 'good' : 'neutral'">
                {{ item.active ? 'aktivan' : 'ugašen' }}
              </UiPill>
            </td>
            <td class="r">
              <div class="k-actions">
                <UiButton small variant="ghost" @click="open(item)">Izmijeni</UiButton>
                <UiButton
                  small
                  :variant="item.active ? 'ghost' : 'soft'"
                  :pending="rowPending === item.id"
                  @click="setActive(item, !item.active)"
                >{{ item.active ? 'Ugasi' : 'Vrati' }}</UiButton>
              </div>
            </td>
          </tr>
        </UiTable>
      </UiCard>
    </template>

    <RobaArtikalSheet
      :open="sheetOpen"
      :item="editing"
      full
      :categories="categories"
      :action="editing ? 'Sačuvaj' : 'Dodaj'"
      :pending="sheetPending"
      :error="sheetError"
      @close="sheetOpen = false"
      @create="create"
      @update="update"
    />
  </div>
</template>

<style scoped>
.k-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

.k-filters { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.k-off-count { font-size: var(--text-micro); color: var(--muted); margin-left: auto; }

.off td { opacity: 0.6; }
.k-muted { color: var(--muted); font-size: var(--text-micro); }
.k-block { display: block; }
.k-actions { display: inline-flex; gap: 6px; justify-content: flex-end; }
</style>
