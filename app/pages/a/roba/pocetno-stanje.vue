<script setup lang="ts">
/**
 * *Početno stanje* — the one-time price list that makes every other number work.
 *
 * Until an article has a purchase cost, every figure computed from it is
 * 0,00 KM: its variance on a popis, its otpis, its utrošak in *Kategorije*. This
 * screen is where the owner reads the real prices in once.
 *
 * **It is one time per article.** The moment an article has any movement that is
 * not an opening — one sale, one delivery — the server answers
 * `409 OPENING_LOCKED` and the fix from then on is a *korekcija* on the
 * article's own page. That is not a limitation to work around: back-dating an
 * opening under a confirmed popis would silently rewrite that popis's manjak.
 *
 * The cost is entered as **what that quantity cost in total**, not per gram.
 * "4.200 g šećera, 8,40 KM" is a sentence the owner can check against an
 * invoice; "0,002 KM po gramu" is one he cannot.
 */
import type { OpeningStockBody } from '#shared/schemas'
import type { StockItemAdmin } from '#shared/types'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Roba — početno stanje' })

const api = useAdminApi()

const items = ref<StockItemAdmin[]>([])
const loading = ref(true)
const error = ref('')
const okText = ref('')
const sending = ref(false)

interface Draft { qty: number | null, total_fen: number | null }
const draft = reactive<Record<string, Draft>>({})

async function load() {
  loading.value = true
  try {
    items.value = await api.getStockItems()
    for (const item of items.value) draft[item.id] ??= { qty: null, total_fen: null }
    error.value = ''
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

onMounted(() => { void load() })

const rows = computed(() => items.value.filter(item => item.active))

/**
 * Milli-feninga per base unit — the column the ledger prices everything in.
 *
 * `total_fen` is feninga for the whole quantity, so one unit costs
 * `total_fen / qty` feninga, and a thousand times that is milli-feninga. The
 * schema's minimum is 1, which is why a 0,00 KM line is simply not sent.
 */
function unitCostMfen(id: string): number | null {
  const row = draft[id]
  if (!row || !row.qty || row.qty <= 0 || !row.total_fen || row.total_fen <= 0) return null
  const mfen = Math.round((row.total_fen * 1000) / row.qty)
  return mfen >= 1 ? mfen : null
}

function unitCostText(item: StockItemAdmin): string {
  const mfen = unitCostMfen(item.id)
  if (mfen === null) return ''
  // Milli-feninga back to feninga, only for display.
  return `${formatKm(Math.round(mfen / 10))} za 100 ${item.base_unit}`
}

/** Only the rows the owner actually filled in are sent. */
const filled = computed(() => rows.value.filter(item => unitCostMfen(item.id) !== null))

async function send() {
  if (filled.value.length === 0 || sending.value) return
  sending.value = true
  error.value = ''
  okText.value = ''
  try {
    const body: OpeningStockBody = {
      lines: filled.value.map(item => ({
        stock_item_id: item.id,
        qty: draft[item.id]!.qty!,
        unit_cost_mfen: unitCostMfen(item.id)!,
      })),
    }
    await api.postOpeningStock(body)
    okText.value = `Upisano početno stanje za ${filled.value.length} artikala.`
    for (const item of filled.value) draft[item.id] = { qty: null, total_fen: null }
    await load()
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="a-page">
    <RobaTabs sub="početno stanje · jednom po artiklu">
      <template #actions>
        <UiButton variant="ghost" @click="navigateTo('/a/roba')">Nazad na stanje</UiButton>
      </template>
    </RobaTabs>

    <UiCard title="Šta ovaj ekran radi">
      <p class="a-note">
        Ovdje se jednom upisuje koliko je robe bilo na polici i koliko je koštala.
        Poslije toga se artikal ispravlja <strong>korekcijom</strong>, ne ovim
        ekranom — server odbija drugi upis kad roba već ima promet.
      </p>
      <p class="a-note">
        Cijena se upisuje kao <strong>ukupan iznos za tu količinu</strong>. Prazan
        red se ne šalje.
      </p>
    </UiCard>

    <p v-if="error" class="a-error">{{ error }}</p>
    <p v-if="okText" class="a-ok">{{ okText }}</p>

    <UiCard title="Artikli" :count="`${filled.length} spremno od ${rows.length}`">
      <p v-if="loading" class="a-note">Učitavanje…</p>

      <div class="a-rows">
        <div v-for="item in rows" :key="item.id" class="a-row">
          <div class="a-row-name">
            <strong>{{ item.name }}</strong>
            <small>
              {{ item.base_unit }}
              <template v-if="item.pack_name && item.pack_qty">
                · {{ item.pack_name }} × {{ item.pack_qty }}
              </template>
            </small>
          </div>

          <UiField
            v-model="draft[item.id]!.qty"
            :label="`Količina (${item.base_unit})`"
            kind="decimal"
          />
          <UiField
            v-model="draft[item.id]!.total_fen"
            label="Koliko je to koštalo (KM)"
            kind="money"
            :hint="unitCostText(item)"
          />
        </div>
      </div>

      <div class="a-foot">
        <UiButton
          variant="primary"
          :disabled="filled.length === 0"
          :pending="sending"
          @click="send"
        >Upiši početno stanje</UiButton>
      </div>

      <p class="a-note">
        Artikal koji već ima promet server odbija: takav se ispravlja korekcijom na
        stranici artikla, ne ovdje.
      </p>
    </UiCard>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.a-error { margin: 0; color: var(--danger); font-size: 14px; }
.a-ok { margin: 0; color: var(--good); font-size: 14px; }
.a-note { margin: 0; color: var(--ink-2); font-size: 14px; }

.a-rows { display: flex; flex-direction: column; gap: 8px; }

.a-row {
  display: grid;
  grid-template-columns: 1fr 160px 200px;
  gap: 12px;
  align-items: center;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg);
}

.a-row-name { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.a-row-name small { color: var(--muted); font-size: 12px; }

.a-foot { display: flex; justify-content: flex-end; }

@media (max-width: 1023px) {
  .a-row { grid-template-columns: 1fr 1fr; }
  .a-row-name { grid-column: 1 / -1; }
  .a-foot > .a-btn { flex-grow: 1; }
}
</style>
