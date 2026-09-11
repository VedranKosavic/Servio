<script setup lang="ts">
/**
 * *Kategorije* — the tabs the waiter's menu is split into, their order, and the
 * quick note chips each one offers.
 *
 * A category is never deleted, only switched off: a category that disappeared in
 * March still has to name the `order_lines` sold in February, and a report whose
 * foreign key no longer resolves is a report that silently loses a column. So
 * *Aktivna* is the only way out, and the sheet says how many products go with it.
 *
 * **Two layouts, one page.** At a desk this is a seven-column table and it
 * should be. In a hand it is a list (`PostavkeKatList`): the name and one quiet
 * line on the row, everything set once a season behind the chevron. The switch
 * is a media query rather than two trees with one of them hidden, so the page
 * renders one sheet and not two.
 *
 * **`useMounted` is not optional.** `useMediaQuery` answers truthfully from the
 * first client render and the server — which has no viewport — always says the
 * laptop, so without the gate the two renders disagree and Vue throws the
 * server's markup away with a hydration mismatch. The first paint is the table
 * at both widths and the phone swaps to the list on mount, before the first read
 * lands: what the owner sees appear is the list.
 *
 * **The order is the list, and moving a row is two writes.** `sort` is an
 * integer and the rows are consecutive, so there is no number to put *between*
 * two neighbours — a move is a swap of the two `sort` values, which is why it
 * cannot be a field on a form with one Save. On a phone that swap is the two
 * arrows in *Redoslijed* mode; the laptop keeps the number in the sheet, where a
 * mouse and a full table make typing "3" a reasonable thing to ask.
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

/** The dashboard's own breakpoint — the width `admin.css` changes density at. */
const mounted = useMounted()
const narrow = useMediaQuery('(max-width: 1023px)')
const isPhone = computed(() => mounted.value && narrow.value)

const categories = ref<CategoryAdmin[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const editing = ref<CategoryAdmin | null>(null)
const sheetOpen = ref(false)
const sheetPending = ref(false)
const sheetError = ref<string | null>(null)

/** The phone's *Redoslijed* mode, and the move it is waiting on. */
const reorder = ref(false)
const moving = ref(false)

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

/** A laptop has no arrows, so it must not be left in a mode that draws them. */
watch(isPhone, (phone) => { if (!phone) reorder.value = false })

/**
 * Where a new category goes: after the last one.
 *
 * The form used to default to `0`, which put every new category in front of
 * *Kafa* on the waiter's phone — a place nobody asked for and the one place a
 * new category is least likely to belong.
 */
const nextSort = computed(() => {
  const highest = categories.value.reduce((max, row) => Math.max(max, row.sort), 0)
  return Math.min(highest + 1, 9999)
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

/**
 * Move a category one place, by swapping `sort` with the neighbour it passes.
 *
 * Two categories can share a `sort` — the list then falls back to the name, and
 * swapping two equal numbers would look like a dead button. In that one case the
 * moved row is nudged to a number of its own instead, which is one write rather
 * than two. Nothing the app writes creates a tie any more: a new category is
 * appended and every move keeps the numbers distinct.
 */
async function move(category: CategoryAdmin, delta: -1 | 1) {
  if (moving.value) return
  const list = categories.value
  const from = list.findIndex(row => row.id === category.id)
  const to = from + delta
  const other = list[to]
  if (from < 0 || !other) return

  moving.value = true
  try {
    if (category.sort !== other.sort) {
      await api.updateCategory(category.id, { sort: other.sort })
      await api.updateCategory(other.id, { sort: category.sort })
    } else if (delta < 0 && other.sort > 0) {
      await api.updateCategory(category.id, { sort: other.sort - 1 })
    } else if (delta < 0) {
      await api.updateCategory(other.id, { sort: other.sort + 1 })
    } else {
      await api.updateCategory(category.id, { sort: Math.min(other.sort + 1, 9999) })
    }
    error.value = null
    await load()
  } catch (err) {
    await load()
    error.value = apiErrorText(err, 'Redoslijed nije snimljen.')
  } finally {
    moving.value = false
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
      <UiButton v-if="isPhone && reorder" variant="primary" @click="reorder = false">
        Gotovo
      </UiButton>
      <template v-else>
        <UiButton variant="primary" @click="open(null)">Nova kategorija</UiButton>
        <UiButton
          v-if="isPhone"
          variant="ghost"
          :disabled="categories.length < 2"
          @click="reorder = true"
        >Redoslijed</UiButton>
      </template>
    </template>

    <!-- ---- the phone --------------------------------------------------- -->
    <PostavkeKatList
      v-if="isPhone"
      :categories="categories"
      :loading="loading"
      :kind-labels="KIND_LABELS"
      :reorder="reorder"
      :busy="moving"
      @open="category => open(category)"
      @move="(category, delta) => move(category, delta)"
    />

    <!-- ---- the laptop -------------------------------------------------- -->
    <UiCard v-else title="Kategorije" :count="categories.length">
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
      :next-sort="nextSort"
      :show-sort="!isPhone"
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
