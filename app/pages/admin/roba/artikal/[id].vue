<script setup lang="ts">
/**
 * One article: what it is worth, and every movement that ever touched it.
 *
 * Paging is a **keyset cursor**, not a page number. `next_cursor` names the
 * oldest row already on screen and the server returns what comes before it; an
 * offset would re-read and re-skip rows every time a new sale shifted the
 * ledger under the owner's thumb.
 *
 * The one thing this page can write is a *korekcija* — the owner's fix, which is
 * an extra row in the ledger and never an edit of an old one.
 */
import type { ItemMovementRow, ItemMovementsPage, StockItemAdmin } from '#shared/types'

definePageMeta({ middleware: 'admin', layout: 'admin' })

const route = useRoute()
const api = useAdminApi()

const itemId = computed(() => String(route.params.id ?? ''))

const head = ref<ItemMovementsPage['item'] | null>(null)
const rows = ref<ItemMovementRow[]>([])
const cursor = ref<string | null>(null)
const loading = ref(true)
const loadingMore = ref(false)
const error = ref('')

/** The catalogue row, for the pack size and the cost the ledger is priced at. */
const admin = ref<StockItemAdmin | null>(null)

useHead(() => ({ title: head.value ? `Roba — ${head.value.name}` : 'Roba' }))

async function load() {
  try {
    const [page, catalogue] = await Promise.all([
      api.getItemMovements(itemId.value, { limit: 50 }),
      api.getStockItems(),
    ])
    head.value = page.item
    rows.value = page.rows
    cursor.value = page.next_cursor
    admin.value = catalogue.find(row => row.id === itemId.value) ?? null
    error.value = ''
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (!cursor.value || loadingMore.value) return
  loadingMore.value = true
  try {
    const page = await api.getItemMovements(itemId.value, { before: cursor.value, limit: 50 })
    rows.value = [...rows.value, ...page.rows]
    cursor.value = page.next_cursor
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    loadingMore.value = false
  }
}

useAdminChanges({
  onEntity: (entity) => {
    if (entity === 'stock' || entity === 'count') void load()
  },
})

onMounted(() => { void load() })

/**
 * The purchase cost, as a price a person can read.
 *
 * Costs are stored in **milli-feninga per base unit** — a thousandth of a
 * fening — because a gram of tobacco costs a fraction of one. Divided down to
 * feninga a bottle reads "0,99 KM"; a gram of sugar would round to "0,00 KM", so
 * a cost that small is quoted per hundred units instead.
 */
const unitCost = computed(() => {
  const mfen = admin.value?.avg_cost_mfen ?? 0
  const unit = admin.value?.base_unit ?? 'kom'
  const perUnit = Math.round(mfen / 1000)
  return perUnit > 0
    ? { text: formatKm(perUnit), per: `po ${unit}` }
    : { text: formatKm(Math.round(mfen / 10)), per: `za 100 ${unit}` }
})

// -- Korekcija ---------------------------------------------------------------

const sheetOpen = ref(false)
const sending = ref(false)
const formError = ref('')
const form = reactive({
  type: 'correction' as 'correction' | 'return_supplier',
  qty_delta: null as number | null,
  note: '',
})

const TYPES = [
  { value: 'correction', label: 'Korekcija' },
  { value: 'return_supplier', label: 'Povrat dobavljaču' },
]

/** A return goes off the shelf, so its quantity is entered as a plain positive. */
const delta = computed(() => {
  const typed = form.qty_delta
  if (typed === null || typed === 0) return null
  return form.type === 'return_supplier' ? -Math.abs(typed) : typed
})

const canSend = computed(() => delta.value !== null && form.note.trim().length >= 3)

function openSheet() {
  form.type = 'correction'
  form.qty_delta = null
  form.note = ''
  formError.value = ''
  sheetOpen.value = true
}

async function send() {
  if (!canSend.value || delta.value === null) return
  sending.value = true
  formError.value = ''
  try {
    await api.correctStock({
      stock_item_id: itemId.value,
      type: form.type,
      qty_delta: delta.value,
      note: form.note.trim(),
    })
    sheetOpen.value = false
    await load()
  } catch (err) {
    formError.value = apiErrorText(err)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="a-page">
    <RobaTabs :sub="head ? `kretanje · ${head.name}` : 'kretanje'">
      <!-- No *Nazad na stanje* here any more: `UiPageHead` draws the way back
           on every screen that is not a tab destination, so a second one would
           be two controls doing one job. -->
      <template #actions>
        <UiButton variant="primary" @click="openSheet">Korekcija</UiButton>
      </template>
    </RobaTabs>

    <p v-if="error" class="a-error">{{ error }}</p>

    <div class="a-tiles">
      <UiTile
        label="Na stanju"
        :value="head ? formatStockQty(head.on_hand, head.base_unit) : '—'"
        :tone="(head?.on_hand ?? 0) < 0 ? 'bad' : 'plain'"
        :sub="admin?.pack_name && admin?.pack_qty ? `paket: ${admin.pack_name} × ${admin.pack_qty}` : 'bez paketa'"
      />
      <UiTile
        label="Nabavna cijena"
        :value="unitCost.text"
        :sub="`${unitCost.per} · ${admin?.estimated_cost ? 'procijenjeno' : 'prosječna'}`"
      />
      <UiTile
        label="Vrijednost"
        :value="formatKm(Math.round(((head?.on_hand ?? 0) * (admin?.avg_cost_mfen ?? 0)) / 1000))"
        sub="stanje × cijena"
      />
      <UiTile
        label="Tolerancija popisa"
        :value="admin ? formatStockQty(admin.tolerance_qty, admin.base_unit) : '—'"
        :sub="admin?.count_method === 'weigh' ? 'mjeri se na vagi' : 'broji se'"
      />
    </div>

    <UiCard title="Kretanje" :count="`${rows.length} redova`">
      <RobaMovements
        :rows="rows"
        :unit="head?.base_unit ?? 'kom'"
        :loading="loading"
        :has-more="cursor !== null"
        :loading-more="loadingMore"
        @more="loadMore"
      />
    </UiCard>

    <UiSheet
      :open="sheetOpen"
      title="Korekcija stanja"
      action="Proknjiži korekciju"
      :pending="sending"
      @close="sheetOpen = false"
      @confirm="send"
    >
      <p class="a-muted">
        Korekcija ne mijenja nijedan stari red — dodaje novi. Napiši šta se desilo,
        jer je ta rečenica jedino objašnjenje koje ostaje u dnevniku.
      </p>

      <UiField
        v-model="form.type"
        label="Vrsta"
        kind="select"
        :options="TYPES"
      />

      <UiField
        v-model="form.qty_delta"
        label="Količina"
        kind="decimal"
        :hint="form.type === 'return_supplier'
          ? 'Koliko ide nazad dobavljaču — upiši pozitivan broj.'
          : 'Plus dodaje na stanje, minus skida.'"
      />

      <UiField
        v-model="form.note"
        label="Napomena"
        kind="textarea"
        placeholder="Npr. gajba nije bila na otpremnici"
        :error="formError"
      />

      <p v-if="delta !== null && head" class="a-muted">
        Novo stanje: {{ formatStockQty(head.on_hand + delta, head.base_unit) }}
      </p>

      <template #footer>
        <UiButton variant="ghost" @click="sheetOpen = false">Odustani</UiButton>
        <UiButton variant="primary" :disabled="!canSend" :pending="sending" @click="send">
          Proknjiži korekciju
        </UiButton>
      </template>
    </UiSheet>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.a-error { margin: 0; color: var(--danger); font-size: var(--text-label); }
.a-muted { margin: 0; color: var(--ink-2); font-size: var(--text-label); }

.a-tiles {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 1023px) {
  .a-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
