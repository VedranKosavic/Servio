<script setup lang="ts">
/**
 * *Stanje šanka* — what is on the shelf, and what tonight has taken off it.
 *
 * **Three sections, not one flat list.** *Kafa*, *Nargila* and everything else,
 * which is the owner's own division of his bar: nineteen articles in one column
 * is a column nobody reads to the end on a phone, and the tobacco, the coffee
 * corner and the bottles are not one kind of thing. The rule is `stanjeGroup()`
 * in `RobaStanjeTable.vue` — the article's own `kind` for *Nargila*, its menu
 * category for *Kafa* — and a section with nothing in it is not drawn.
 *
 * **Three articles are not here any more.** *Ugalj (kocke)*, *Šećer* and *Kafa
 * (mljevena)* are consumables the café does not count: coffee is effectively
 * infinite, unlike a bottle of Coca-Cola. They are deactivated rather than
 * deleted, so their ledger still reads, and both shelf reads list active
 * articles only — `server/database/retire.ts` says what that costs.
 *
 * **The four tiles are gone**, and so is *Bez normativa*. *Vrijednost zaliha*,
 * *U minusu*, *Nisko* and *Bez cijene* sat above the list and answered questions
 * nobody opens this screen to ask; on a phone they were most of the first
 * screenful. The two that were really warnings are still here as chips that
 * filter the list — a count you can tap is the useful version of the same fact.
 * The *Bez normativa* nag went out on the owner's call: the recipes themselves
 * stay, because `recipe_lines` is how a sale deducts stock.
 *
 * **Two numbers per article.** The big one is *settled*: the shelf as the last
 * closed shift left it. Beside it, in `--danger`, is what tonight's open shift
 * has moved — `48 kom` and `−3`. It is drawn only when it is not zero, and it
 * folds into the settled figure by itself when the shift closes.
 *
 * That split is a **read model and nothing more** (`docs/BACKEND.md` §6.8).
 * Stock is still deducted inside the order-lock transaction, the ledger is still
 * append-only and on hand is still `SUM(qty_delta)`; `GET /api/stock` simply
 * reports the same sum in two halves, cut at `stock_movements.shift_id`, so
 * `settled + pending` is the on-hand every other screen shows. Nothing is
 * written when a shift closes — the red number stops being pending because the
 * shift stops being open.
 *
 * **Two layouts, one page.** At a desk each section is a card with a dense table
 * in it and should be: articles compared across quantity, packs, value and
 * status at a glance. In a hand that table is a sideways drag, so below 1024 px
 * the sections become lists (`RobaStanjeList`) — name and quantity on the row,
 * the state as a small mark, everything else one tap behind the row in
 * `RobaStanjeSheet`. Nothing on this screen scrolls sideways at any width.
 *
 * **`useMounted` is not optional.** `useMediaQuery` answers truthfully from the
 * first client render and the server, which has no viewport, always says the
 * laptop; without the gate the two renders disagree and Vue throws the server's
 * markup away with a hydration mismatch.
 *
 * Three reads, one poll. `useAdminChanges` is the dashboard's single timer: this
 * page opens none of its own, it says which entities matter and refetches only
 * when one of them moves.
 */
import {
  buildStanjeRows, groupStanjeRows, matchesFilter,
  type StanjeFilter, type StanjeRow,
} from '~/components/roba/RobaStanjeTable.vue'
import type { CategoryAdmin, CountView, OwnerStockReport, StockItem } from '#shared/types'
import type { CreateStockItemBody } from '#shared/schemas'
import { linkedProductBody, menuLinkError } from '~/utils/stanjeNovi'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Roba — stanje šanka' })

const api = useAdminApi()

/** The dashboard's own breakpoint — the width `admin.css` changes density at. */
const mounted = useMounted()
const narrow = useMediaQuery('(max-width: 1023px)')
const isPhone = computed(() => mounted.value && narrow.value)

const report = ref<OwnerStockReport | null>(null)
const live = ref<StockItem[]>([])
const counts = ref<CountView[]>([])
const loading = ref(true)
const error = ref('')
const filter = ref<StanjeFilter>('sve')

/**
 * The article whose sheet is open, **by id and not by object**: the poll
 * replaces every row every fifteen seconds, and a sheet holding the old object
 * would go on showing a quantity the shelf no longer has.
 */
const sheetId = ref<string | null>(null)

async function load() {
  try {
    // Three independent reads, so they go out together rather than in a chain.
    const [stockReport, stockLive, confirmed] = await Promise.all([
      api.getOwnerStock(),
      api.getStock(),
      api.getCounts({ status: 'confirmed' }),
    ])
    report.value = stockReport
    live.value = stockLive.items
    counts.value = confirmed
    error.value = ''
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

useAdminChanges({
  onEntity: (entity) => {
    if (entity === 'stock' || entity === 'count') void load()
  },
})

// The session is an httpOnly cookie the browser holds, so every read on `/admin`
// happens after mount — a server render would ask `/api/me` with no cookie jar
// and be told nobody is logged in. `middleware/admin.ts` says the same thing.
onMounted(() => { void load() })

const rows = computed<StanjeRow[]>(() =>
  buildStanjeRows(report.value?.items ?? [], live.value, counts.value))

const shown = computed(() => rows.value.filter(row => matchesFilter(row, filter.value)))

/** *Kafa*, *Nargila*, *Ostalo* — of what the filter left standing. */
const sections = computed(() => groupStanjeRows(shown.value))

/** The sheet's article, read fresh every render. Null closes the sheet. */
const sheetRow = computed(() => rows.value.find(row => row.id === sheetId.value) ?? null)

/**
 * Is a shift open and has it moved anything yet?
 *
 * This is what turns the legend on. A sentence explaining a red number on a
 * screen with no red number on it is a sentence that teaches nobody anything
 * and costs a row of every quiet afternoon.
 */
const anyPending = computed(() => rows.value.some(row => row.pending !== 0))

/** The nag lists of PLAN §9 that survived, each with the count of its rows. */
const CHIPS: Array<{ key: StanjeFilter, label: string }> = [
  { key: 'u-minusu', label: 'U minusu' },
  { key: 'bez-cijene', label: 'Bez cijene' },
  { key: 'kasno', label: 'Kasno sinhronizovano' },
]

function chipCount(key: StanjeFilter): number {
  return rows.value.filter(row => matchesFilter(row, key)).length
}

/**
 * On a phone, a nag chip appears only when it has something in it.
 *
 * Three chips wrap to two rows at 390 px, which put a screenful of *filters that
 * would empty the list* above the first article — and all three say 0 on a
 * healthy night. At a desk they fit on one line and a zero is worth reading
 * there ("nothing is in minus" is an answer), so the laptop keeps all three. The
 * active one never disappears, whatever its count falls to, or the filter would
 * become impossible to switch off.
 */
const visibleChips = computed(() => (isPhone.value
  ? CHIPS.filter(chip => chipCount(chip.key) > 0 || filter.value === chip.key)
  : CHIPS))

/** A second tap on the active chip clears it — the chips are one filter, not three. */
function toggle(key: StanjeFilter) {
  filter.value = filter.value === key ? 'sve' : key
}

// -- Novi artikal --------------------------------------------------------------
//
// The shelf article is the short `RobaArtikalSheet`; *Prodaje se na meniju* adds
// the menu article in the same step, linked 1:1 (`app/utils/stanjeNovi.ts`), so a
// sale deducts it with no normativ. This page is admin-only (`middleware: 'admin'`);
// the staff's `/stanje` has no such button.

const newOpen = ref(false)
const newPending = ref(false)
const newError = ref<string | null>(null)
const menuCategories = ref<CategoryAdmin[]>([])
const onMenu = ref(true)
const menuCategoryId = ref('')
const menuPriceFen = ref<number | null>(null)

const menuCategoryOptions = computed(() => [
  { value: '', label: 'Izaberi kategoriju' },
  ...menuCategories.value.map(category => ({ value: category.id, label: category.name })),
])

async function openNew() {
  newError.value = null
  onMenu.value = true
  menuCategoryId.value = ''
  menuPriceFen.value = null
  newOpen.value = true
  try {
    menuCategories.value = (await api.getAdminCategories()).filter(category => category.active)
  } catch (err) {
    newError.value = apiErrorText(err, 'Kategorije se nisu učitale.')
  }
}

async function createArticle(body: CreateStockItemBody) {
  const link = { categoryId: menuCategoryId.value, priceFen: menuPriceFen.value }
  if (onMenu.value) {
    const problem = menuLinkError(link, body.base_unit)
    if (problem) {
      newError.value = problem
      return
    }
  }

  newPending.value = true
  newError.value = null
  try {
    const item = await api.createStockItem({
      ...body,
      // The *Roba* report groups a shelf article under its menu category.
      category_id: onMenu.value ? link.categoryId : null,
    })
    if (onMenu.value) {
      try {
        await api.createProduct(linkedProductBody(item.id, body.name, link))
      } catch (err) {
        // The shelf half landed; saving the sheet again would add it twice.
        newOpen.value = false
        error.value = `„${item.name}“ je dodan na stanje, ali ne i na meni: ${apiErrorText(err)}`
        await load()
        return
      }
    }
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
  <div class="a-page">
    <RobaTabs sub="stanje šanka · sve što stoji na polici">
      <template #actions>
        <UiButton variant="ghost" @click="navigateTo('/admin/roba/pocetno-stanje')">
          Početno stanje
        </UiButton>
        <UiButton variant="primary" @click="openNew">Novi artikal</UiButton>
      </template>
    </RobaTabs>

    <p v-if="error" class="a-error">{{ error }}</p>

    <!-- The filters and the legend sit on the page's own ground, above the
         sections: a card around them would be a fourth card competing with the
         three the screen is about. -->
    <div v-if="visibleChips.length > 0 || filter !== 'sve'" class="a-chips">
      <button
        v-for="chip in visibleChips"
        :key="chip.key"
        type="button"
        class="a-chip"
        :class="{ on: filter === chip.key }"
        :aria-pressed="filter === chip.key"
        @click="toggle(chip.key)"
      >{{ chip.label }} {{ chipCount(chip.key) }}</button>
      <button
        v-if="filter !== 'sve'"
        type="button"
        class="a-chip"
        @click="filter = 'sve'"
      >Prikaži sve</button>
    </div>

    <!-- The legend, said once, and only while there is something red to
         explain. `role="status"` because it appears when the first round of
         the night lands, under somebody who is already looking at the list. -->
    <p v-if="anyPending" class="a-legend" role="status">
      Crveno je večerašnja smjena; ulazi u stanje kad se smjena zatvori.
    </p>

    <!-- ---- the phone ---------------------------------------------------- -->
    <RobaStanjeList
      v-if="isPhone"
      :sections="sections"
      :loading="loading"
      @open="row => sheetId = row.id"
    />

    <!-- ---- the laptop --------------------------------------------------- -->
    <template v-else>
      <UiCard v-if="loading" title="Stanje šanka">
        <RobaStanjeTable :rows="[]" loading />
      </UiCard>

      <UiCard
        v-for="section in loading ? [] : sections"
        :key="section.key"
        :title="section.label"
        :count="section.rows.length"
      >
        <RobaStanjeTable :rows="section.rows" />
      </UiCard>
    </template>

    <p v-if="!loading && sections.length === 0" class="a-empty">
      Nema robe za ovaj filter.
    </p>

    <RobaStanjeSheet
      :open="sheetRow !== null"
      :row="sheetRow"
      @close="sheetId = null"
    />

    <RobaArtikalSheet
      :open="newOpen"
      action="Dodaj"
      :pending="newPending"
      :error="newError"
      @close="newOpen = false"
      @create="createArticle"
    >
      <template #note>
        <div class="n-menu">
          <div class="n-row">
            <span class="n-text">
              <strong>Prodaje se na meniju</strong>
              <small>Konobar ga naručuje, a svaki poslani komad skida 1 sa stanja.</small>
            </span>
            <PostavkeToggle v-model="onMenu" label="Prodaje se na meniju" words />
          </div>
          <template v-if="onMenu">
            <UiField
              :model-value="menuCategoryId"
              label="Kategorija na meniju"
              kind="select"
              :options="menuCategoryOptions"
              @update:model-value="value => menuCategoryId = String(value ?? '')"
            />
            <PostavkeNumField
              label="Cijena na meniju"
              :model-value="menuPriceFen"
              kind="money"
              suffix="KM"
              @input="value => menuPriceFen = value"
              @commit="value => menuPriceFen = value"
            />
          </template>
        </div>
      </template>
    </RobaArtikalSheet>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

.a-error { margin: 0; color: var(--danger); font-size: var(--text-label); }

/* The menu half of *Novi artikal*: set apart from the shelf fields by one rule. */
.n-menu {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line-soft);
}

.n-row { display: flex; align-items: center; gap: 12px; }
.n-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex-grow: 1; }
.n-text strong { font-size: var(--text-body); font-weight: 600; color: var(--ink); }
.n-text small { font-size: var(--text-micro); color: var(--muted); }

/* `.a-chips` and `.a-chip` are one definition in `admin.css`. */

.a-legend {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-micro);
}

.a-empty {
  margin: 0;
  padding: 22px 16px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-card);
  color: var(--muted);
  font-size: var(--text-body);
  text-align: center;
}
</style>
