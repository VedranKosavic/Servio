<script setup lang="ts">
/**
 * *Novi popis* — the whole count, built here and posted in one call.
 *
 * **There is no server-side draft.** `POST /api/stock/counts` creates the count
 * *and* submits it in one transaction; the in-progress list lives on the client
 * until the owner presses *Pošalji popis*, exactly as it does on the phone. Do
 * not look for a route that adds a line to a saved count — there is none, and
 * there must not be one, because a half-saved count reads as a clean variance.
 *
 * Two refusals this form has to render properly:
 *
 * - **422 `NOTE_REQUIRED`** names the item ids whose variance is beyond
 *   tolerance and carries no explanation. Those rows are highlighted and the
 *   note field on each one is what the server is waiting for.
 * - **409 `PENDING_OUTBOX`** means a phone in this shift is still holding
 *   rounds that are not on the server. Counting against a shelf whose last
 *   twenty minutes have not arrived produces a manjak that is not real, so the
 *   answer is to wait — or, for an admin who knows the phone is simply switched
 *   off, to tick *Ipak pošalji*.
 */
import type { SubmitCountBody } from '#shared/schemas'
import type { CountView, StockItemAdmin } from '#shared/types'

const props = defineProps<{
  items: StockItemAdmin[]
}>()

const emit = defineEmits<{ submitted: [count: CountView] }>()

const api = useAdminApi()

const kind = ref<'spot' | 'full'>('spot')
const phase = ref<'open' | 'close' | 'adhoc'>('adhoc')
const note = ref('')
const override = ref(false)
const sending = ref(false)
const error = ref('')
/** Item ids the server refused on — highlighted until they are answered. */
const flagged = ref<string[]>([])

const KINDS = [
  { value: 'spot', label: 'Spot popis' },
  { value: 'full', label: 'Puni popis' },
]

const PHASES = [
  { value: 'open', label: 'Otvaranje smjene' },
  { value: 'close', label: 'Zatvaranje smjene' },
  { value: 'adhoc', label: 'Vanredni' },
]

/**
 * A *spot* count is the short list everybody agreed to count every night, and
 * half of it is not a count: the server refuses one that leaves a spot item out.
 * So a spot count offers exactly the spot items and a full one offers all.
 */
const counted = computed(() => props.items
  .filter(item => item.active && (kind.value === 'full' || item.is_spot)))

/** One draft line per offered item, keyed by item id. */
interface Draft { packs: number | null, loose: number | null, weighed_g: number | null, note: string }
const draft = reactive<Record<string, Draft>>({})

watch(counted, (list) => {
  for (const item of list) {
    draft[item.id] ??= { packs: null, loose: null, weighed_g: null, note: '' }
  }
}, { immediate: true })

/** What the count says is on the shelf, in the item's base unit. */
function countedQty(item: StockItemAdmin): number {
  const row = draft[item.id]
  if (!row) return 0
  if (item.count_method === 'weigh') {
    // A scale weighs the tin too: gross grams less the tare. The server does
    // the same subtraction; this is only so the owner sees it before he sends.
    return Math.max(0, (row.weighed_g ?? 0) - (item.tare_g ?? 0))
  }
  return Math.max(0, (row.packs ?? 0) * (item.pack_qty ?? 0) + (row.loose ?? 0))
}

/** Nothing typed at all — the server would read it as "zero on the shelf". */
function isBlank(item: StockItemAdmin): boolean {
  const row = draft[item.id]
  if (!row) return true
  return row.packs === null && row.loose === null && row.weighed_g === null
}

const blanks = computed(() => counted.value.filter(isBlank).length)

async function send() {
  if (sending.value) return
  sending.value = true
  error.value = ''
  flagged.value = []
  try {
    const body: SubmitCountBody = {
      kind: kind.value,
      phase: phase.value,
      note: note.value.trim() || undefined,
      override: override.value || undefined,
      lines: counted.value.map((item) => {
        const row = draft[item.id]!
        return item.count_method === 'weigh'
          ? { stock_item_id: item.id, weighed_g: row.weighed_g ?? 0, note: row.note.trim() || undefined }
          : {
              stock_item_id: item.id,
              packs: row.packs ?? 0,
              loose: row.loose ?? 0,
              note: row.note.trim() || undefined,
            }
      }),
    }
    const saved = await api.submitCount(body)
    emit('submitted', saved)
  } catch (err) {
    error.value = apiErrorText(err)
    const data = (err as { data?: Record<string, unknown> })?.data
    const ids = data?.item_ids
    if (Array.isArray(ids)) flagged.value = ids.map(String)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <UiCard title="Novi popis" :count="`${counted.length} stavki`">
    <div class="a-head-fields">
      <UiField v-model="kind" label="Vrsta" kind="select" :options="KINDS" />
      <UiField v-model="phase" label="Trenutak" kind="select" :options="PHASES" />
      <UiField v-model="note" label="Napomena" placeholder="Neobavezno" />
    </div>

    <div class="a-rows">
      <div
        v-for="item in counted"
        :key="item.id"
        class="a-row"
        :class="{ flagged: flagged.includes(item.id) }"
      >
        <div class="a-row-name">
          <strong>{{ item.name }}</strong>
          <small>
            {{ item.count_method === 'weigh' ? 'vaga' : 'brojanje' }}
            <template v-if="item.pack_qty && item.pack_name">
              · {{ item.pack_name }} × {{ item.pack_qty }}
            </template>
            <template v-if="item.count_method === 'weigh' && item.tare_g">
              · tara {{ item.tare_g }} g
            </template>
          </small>
        </div>

        <div class="a-row-inputs">
          <template v-if="item.count_method === 'weigh'">
            <UiField
              v-model="draft[item.id]!.weighed_g"
              label="Na vagi (g)"
              kind="decimal"
            />
          </template>
          <template v-else>
            <UiField
              v-model="draft[item.id]!.packs"
              label="Paketi"
              kind="decimal"
              :disabled="!item.pack_qty"
            />
            <UiField v-model="draft[item.id]!.loose" label="Komadi" kind="decimal" />
          </template>
          <UiField
            v-model="draft[item.id]!.note"
            label="Napomena"
            :placeholder="flagged.includes(item.id) ? 'Obavezno — objasni razliku' : 'Neobavezno'"
          />
        </div>

        <div class="a-row-sum">{{ formatStockQty(countedQty(item), item.base_unit) }}</div>
      </div>
    </div>

    <p v-if="blanks > 0" class="a-muted">
      {{ blanks }} stavki još nije popisano — prazno polje server čita kao nulu na polici.
    </p>

    <label class="a-override">
      <input v-model="override" type="checkbox">
      <span>Ipak pošalji, i kad telefon još drži neposlane ture</span>
    </label>

    <p v-if="error" class="a-error">{{ error }}</p>

    <div class="a-foot">
      <UiButton
        variant="primary"
        :disabled="counted.length === 0"
        :pending="sending"
        @click="send"
      >Pošalji popis</UiButton>
    </div>
  </UiCard>
</template>

<style scoped>
.a-head-fields { display: grid; grid-template-columns: 1fr 1fr 2fr; gap: 12px; }

.a-rows { display: flex; flex-direction: column; gap: 8px; }

.a-row {
  display: grid;
  grid-template-columns: 220px 1fr 110px;
  gap: 12px;
  align-items: center;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg);
}

/* A row the server refused: the colour is a hint, the placeholder is the reason. */
.a-row.flagged { background: var(--warn-soft); border-color: var(--warn); }

.a-row-name { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.a-row-name small { color: var(--muted); font-size: 12px; }

.a-row-inputs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }

.a-row-sum {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.a-override { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-2); }
.a-override input { width: 18px; height: 18px; }

.a-muted { margin: 0; color: var(--muted); font-size: 13px; }
.a-error { margin: 0; color: var(--danger); font-size: 14px; }
.a-foot { display: flex; justify-content: flex-end; }

@media (max-width: 1023px) {
  .a-head-fields { grid-template-columns: 1fr; }
  .a-row { grid-template-columns: 1fr; }
  .a-row-inputs { grid-template-columns: 1fr 1fr; }
  .a-row-sum { text-align: left; }
  .a-override { min-height: 44px; }
  .a-foot > .a-btn { flex-grow: 1; }
}
</style>
