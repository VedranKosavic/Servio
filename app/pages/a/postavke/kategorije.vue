<script setup lang="ts">
/**
 * *Kategorije* — the tabs the waiter's menu is split into, and the quick note
 * chips each one offers.
 *
 * A category is never deleted, only switched off: a category that disappeared in
 * March still has to name the `order_lines` sold in February, and a report whose
 * foreign key no longer resolves is a report that silently loses a column. So
 * *Aktivna* is the only way out, and the sheet says how many products go with it.
 */
import type { CategoryAdmin } from '#shared/types'
import type { CreateCategoryBody, UpdateCategoryBody } from '#shared/schemas'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Kategorije' })

const api = useAdminApi()

const KIND_LABELS: Record<string, string> = {
  pice: 'Piće',
  hrana: 'Hrana',
  nargila: 'Nargila',
  ostalo: 'Ostalo',
}

const categories = ref<CategoryAdmin[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const editing = ref<CategoryAdmin | null>(null)
const sheetOpen = ref(false)
const sheetPending = ref(false)
const sheetError = ref<string | null>(null)

async function load() {
  try {
    categories.value = await api.getAdminCategories()
    error.value = null
  } catch (err) {
    error.value = apiErrorText(err, 'Kategorije se nisu učitale.')
  } finally {
    loading.value = false
  }
}

onMounted(() => { void load() })

useAdminChanges({
  onEntity: (entity) => { if (entity === 'menu') void load() },
})

const columns = [
  { key: 'naziv', label: 'Kategorija' },
  { key: 'vrsta', label: 'Vrsta', width: '110px' },
  { key: 'artikala', label: 'Artikala', align: 'r' as const, width: '90px' },
  { key: 'napomene', label: 'Napomene' },
  { key: 'sort', label: 'Sortiranje', align: 'r' as const, width: '100px' },
  { key: 'aktivna', label: 'Aktivna', width: '100px' },
  { key: 'akcija', label: '', align: 'r' as const, width: '110px' },
]

function open(category: CategoryAdmin | null) {
  editing.value = category
  sheetError.value = null
  sheetOpen.value = true
}

async function create(body: CreateCategoryBody) {
  sheetPending.value = true
  try {
    await api.createCategory(body)
    sheetOpen.value = false
    await load()
  } catch (err) {
    sheetError.value = apiErrorText(err, 'Kategorija nije dodana.')
  } finally {
    sheetPending.value = false
  }
}

async function update(id: string, patch: UpdateCategoryBody) {
  sheetPending.value = true
  try {
    await api.updateCategory(id, patch)
    sheetOpen.value = false
    await load()
  } catch (err) {
    sheetError.value = apiErrorText(err, 'Izmjena nije snimljena.')
  } finally {
    sheetPending.value = false
  }
}
</script>

<template>
  <PostavkePage
    title="Kategorije"
    sub="Tabovi menija i brze napomene"
    :error="error"
  >
    <template #actions>
      <UiButton variant="primary" @click="open(null)">Nova kategorija</UiButton>
    </template>

    <UiCard title="Kategorije" :count="categories.length">
      <UiTable :columns="columns" :loading="loading" empty="Nema kategorija.">
        <tr v-for="category in categories" :key="category.id" :class="{ off: !category.active }">
          <td><strong>{{ category.name }}</strong></td>
          <td>{{ KIND_LABELS[category.kind] ?? category.kind }}</td>
          <td class="r">{{ category.product_count }}</td>
          <td>
            <span v-if="category.note_chips.length === 0" class="p-muted">—</span>
            <span v-else class="p-chips">
              <UiPill v-for="chip in category.note_chips" :key="chip" tone="neutral">
                {{ chip }}
              </UiPill>
            </span>
          </td>
          <td class="r">{{ category.sort }}</td>
          <td>
            <UiPill :tone="category.active ? 'good' : 'neutral'">
              {{ category.active ? 'aktivna' : 'ugašena' }}
            </UiPill>
          </td>
          <td class="r">
            <UiButton small variant="ghost" @click="open(category)">Izmijeni</UiButton>
          </td>
        </tr>
      </UiTable>
    </UiCard>

    <PostavkeCategorySheet
      :open="sheetOpen"
      :category="editing"
      :pending="sheetPending"
      :error="sheetError"
      @close="sheetOpen = false"
      @create="create"
      @update="update"
    />
  </PostavkePage>
</template>

<style scoped>
.off td { opacity: 0.55; }
.p-muted { color: var(--muted); }
.p-chips { display: inline-flex; flex-wrap: wrap; gap: 4px; }
</style>
