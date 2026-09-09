<script setup lang="ts">
/**
 * *Smjena* — one night, top to bottom.
 *
 * Everything on this page comes from **one** read, `GET /api/owner/shift/:id`,
 * which answers the shift, its written summary, the per-waiter fold, the cash
 * movements, the envelopes, the counts and what arrived after closing. The
 * second read is `GET /api/admin/settings`, and it is here for one word: the
 * tolerance the difference is judged against. Nothing else on the screen fetches.
 *
 * **The numbers reconcile against each other, not against a second read.** Pazar
 * is `summary.promet_fen`; gotovina + kartica + nenaplaćeno come out of the same
 * fold, so the tiles and the strip cannot print two different nights.
 *
 * The refetch is the shell's poll (`useAdminChanges`), narrowed to the three
 * entities that can change what is on this page: a shift row, a decision on an
 * adjustment, a count being confirmed. There is no `setInterval` here.
 */
import { ApiSideError } from '~/composables/useApi'
import { cashVerdict, decimalBs, perBowl, stockVarianceNote } from '~/components/smjena/smjenaLogic'
import type { OwnerShift, Settings } from '#shared/types'

definePageMeta({ middleware: 'admin', layout: 'admin' })

const route = useRoute()
const api = useAdminApi()
const me = useMe()
const changes = useAdminChanges({
  onEntity: (entity) => {
    if (entity === 'shift' || entity === 'adjustment' || entity === 'count') void load()
  },
})

const shiftId = computed(() => String(route.params.id))

const data = ref<OwnerShift | null>(null)
const settings = ref<Settings | null>(null)
const loading = ref(true)
const error = ref('')

/** Which row's button is spinning. One at a time: a decision is not a batch. */
const busyId = ref<string | null>(null)
const actionError = ref('')

// -- the review form ---------------------------------------------------------

const cardTotal = ref<number | null>(null)
const closingNote = ref('')
const reviewPending = ref(false)
const reviewError = ref('')
const noteRequired = ref(false)

async function load() {
  try {
    const [shift, config] = await Promise.all([
      api.getShift(shiftId.value),
      settings.value ? Promise.resolve(settings.value) : api.getSettings(),
    ])
    data.value = shift
    settings.value = config
    // Only seed the form while it is untouched, so a poll landing mid-typing
    // cannot overwrite what the owner is in the middle of entering.
    if (cardTotal.value === null) cardTotal.value = shift.shift.card_total_fen
    if (!closingNote.value) closingNote.value = shift.shift.closing_note ?? ''
    error.value = ''
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

/**
 * The read happens in the browser, not during the server render.
 *
 * The session is a httpOnly cookie the *server* reads off the request, and a
 * server-side `$fetch` to our own API would go out without it — the `admin`
 * middleware is client-side for the same reason (`useMe`). So the first paint is
 * the skeleton and the numbers arrive a moment later.
 */
onMounted(load)

useHead({
  title: () => data.value ? `Smjena ${dateBs(data.value.shift.business_date)}` : 'Smjena',
})

/**
 * `user_id` → name, from the rows this page already holds.
 *
 * `Shift` carries `closed_by` and `reviewed_by` as ids and no names, so the
 * header assembles them from the people it can already see: the summary's
 * per-waiter fold, the envelopes, the cash movements and the counts. An id
 * nobody on this page has seen simply renders without a name rather than as a
 * UUID — and the owner reading his own review sees himself, because `useMe`
 * knows who he is.
 */
const names = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {}
  const shift = data.value
  if (me.user.value) map[me.user.value.id] = me.user.value.name
  if (!shift) return map

  map[shift.shift.opened_by] = shift.shift.opened_by_name
  for (const user of shift.by_user) map[user.user_id] = user.name
  for (const s of shift.settlements) {
    map[s.user_id] = s.user_name
    if (s.accepted_by && s.accepted_by_name) map[s.accepted_by] = s.accepted_by_name
  }
  for (const m of shift.cash_movements) {
    map[m.user_id] = m.user_name
    map[m.created_by] = m.created_by_name
  }
  for (const c of shift.counts) map[c.counted_by] = c.counted_by_name
  return map
})

// -- the tiles ---------------------------------------------------------------

const bowls = computed(() => data.value ? perBowl(data.value.summary) : null)

const cashWord = computed(() => {
  const shift = data.value
  if (!shift || !settings.value) return null
  return cashVerdict(shift.summary.diff_fen, shift.summary.expected_cash_fen, settings.value)
})

/**
 * `category_id` → name, from the one fold that has them.
 *
 * `summary.by_category` comes back named; `by_user[].by_category` is the stored
 * numeric JSON and does not. One map here beats a second read of the catalogue.
 */
const categoryNames = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {}
  for (const line of data.value?.summary.by_category ?? []) {
    if (line.name) map[line.category_id] = line.name
  }
  return map
})

/** What the *Manjak robe* tile says under its amount. */
const stockNote = computed(() => stockVarianceNote(data.value?.counts ?? []))

// -- the decisions -----------------------------------------------------------

/** Every action does the same three things, so it is written once. */
async function act(id: string, run: () => Promise<unknown>) {
  busyId.value = id
  actionError.value = ''
  try {
    await run()
    await load()
    // Tell the shell's badge straight away rather than waiting out the 15 s.
    await changes.refresh()
  } catch (err) {
    actionError.value = apiErrorText(err)
  } finally {
    busyId.value = null
  }
}

function decideMovement(id: string, outcome: 'approved' | 'rejected') {
  return act(id, () => api.decideCashMovement(id, { outcome }))
}

function acceptSettlement(settlementId: string) {
  return act(settlementId, () => api.acceptSettlement(shiftId.value, settlementId))
}

function confirmCount(countId: string) {
  return act(countId, () => api.confirmCount(countId, {}))
}

async function review() {
  reviewPending.value = true
  reviewError.value = ''
  noteRequired.value = false
  try {
    await api.reviewShift(shiftId.value, {
      ...(cardTotal.value === null ? {} : { card_total_fen: cardTotal.value }),
      ...(closingNote.value.trim() ? { closing_note: closingNote.value.trim() } : {}),
    })
    await load()
    await changes.refresh()
  } catch (err) {
    // 422 NOTE_REQUIRED: the card total differs from the card payments and the
    // server wants a sentence about why before it signs the night off.
    if (err instanceof ApiSideError && err.code === 'NOTE_REQUIRED') noteRequired.value = true
    reviewError.value = apiErrorText(err)
  } finally {
    reviewPending.value = false
  }
}

// -- the two drawer sheets ---------------------------------------------------

const sheet = ref<'pickup' | 'opening' | null>(null)
const sheetAmount = ref<number | null>(null)
const sheetNote = ref('')
const sheetPending = ref(false)
const sheetError = ref('')

function openSheet(kind: 'pickup' | 'opening') {
  sheet.value = kind
  sheetAmount.value = kind === 'opening'
    ? data.value?.shift.opening_float_override_fen ?? null
    : null
  sheetNote.value = ''
  sheetError.value = ''
}

async function submitSheet() {
  if (sheetAmount.value === null) {
    sheetError.value = 'Upiši iznos'
    return
  }
  sheetPending.value = true
  sheetError.value = ''
  try {
    if (sheet.value === 'pickup') {
      await api.pickup(shiftId.value, {
        amount_fen: sheetAmount.value,
        ...(sheetNote.value.trim() ? { note: sheetNote.value.trim() } : {}),
      })
    } else {
      await api.openingFloat(shiftId.value, { fen: sheetAmount.value })
    }
    sheet.value = null
    await load()
    await changes.refresh()
  } catch (err) {
    sheetError.value = apiErrorText(err)
  } finally {
    sheetPending.value = false
  }
}
</script>

<template>
  <div class="a-page">
    <p v-if="error" class="a-error">{{ error }}</p>

    <template v-if="data && settings">
      <SmjenaHeader
        v-model:card-total="cardTotal"
        v-model:note="closingNote"
        :shift="data.shift"
        :names="names"
        :pending="reviewPending"
        :error="reviewError"
        :note-required="noteRequired"
        @review="review"
      />

      <div class="a-tiles">
        <UiTile label="Pazar" :value="formatAmount(data.summary.promet_fen)" sub="KM" />
        <UiTile
          label="Gotovina / kartica"
          :value="formatAmount(data.summary.cash_fen)"
          :sub="`KM · kartica ${formatKm(data.summary.card_fen)}`"
        />
        <UiTile
          label="Gratis · storna"
          :value="formatAmount(data.summary.comp_fen)"
          :sub="`KM · storna ${data.summary.void_count} · ${formatKm(data.summary.void_fen)}`"
        />
        <UiTile
          label="Razlika gotovine"
          :value="data.summary.diff_fen === null ? '—' : signedAmount(data.summary.diff_fen)"
        >
          <template #sub>
            <span class="a-sub">
              <span>KM</span>
              <UiPill v-if="cashWord" :tone="cashWord.tone">{{ cashWord.word }}</UiPill>
              <span v-else>smjena nije zatvorena</span>
            </span>
          </template>
        </UiTile>
        <UiTile
          label="Manjak robe"
          :value="signedAmount(data.summary.stock_variance_fen)"
          :tone="data.summary.stock_variance_fen < 0 ? 'bad' : 'plain'"
          :sub="stockNote"
        />
        <UiTile
          label="Lule"
          :value="data.summary.bowls"
          :sub="bowls
            ? `${decimalBs(bowls.grams)} g/luli · ${decimalBs(bowls.coals)} žara`
            : 'nijedna lula'"
        />
      </div>

      <p v-if="actionError" class="a-error">{{ actionError }}</p>

      <SmjenaWaiterStrip
        :shift-id="data.shift.id"
        :users="data.by_user"
        :settlements="data.settlements"
        :settings="settings"
        :category-names="categoryNames"
      />

      <SmjenaCategoryBar :shift-id="data.shift.id" :categories="data.summary.by_category" />

      <div class="a-two">
        <SmjenaCashBox
          :shift="data.shift"
          :summary="data.summary"
          :movements="data.cash_movements"
          :settlements="data.settlements"
          :users="data.by_user"
          :settings="settings"
          :busy-id="busyId"
          @decide="decideMovement"
          @accept="acceptSettlement"
          @pickup="openSheet('pickup')"
          @opening-float="openSheet('opening')"
        />

        <div class="a-stack">
          <SmjenaCounts :counts="data.counts" :busy-id="busyId" @confirm="confirmCount" />
          <SmjenaAfterClose :late="data.late_after_close" />
        </div>
      </div>

      <UiSheet
        :open="sheet !== null"
        :title="sheet === 'pickup' ? 'Uzeo iz kase' : 'Početni polog'"
        :action="sheet === 'pickup' ? 'Zabilježi' : 'Sačuvaj'"
        :pending="sheetPending"
        @close="sheet = null"
        @confirm="submitSheet"
      >
        <UiField
          v-model="sheetAmount"
          label="Iznos"
          kind="money"
          hint="Unosi se u KM"
          :error="sheetError"
        />
        <UiField
          v-if="sheet === 'pickup'"
          v-model="sheetNote"
          label="Napomena"
          placeholder="Nije obavezno"
        />
        <p v-else class="a-muted">
          Ovo je gotovina koja je bila u kasi kad je smjena počela. Upiši je samo
          ako izvedeni iznos nije tačan.
        </p>
      </UiSheet>
    </template>

    <!-- A skeleton, not a spinner over stale numbers. -->
    <div v-else-if="loading" class="a-skeleton">
      <span v-for="n in 6" :key="n" />
    </div>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 18px; min-width: 0; }

.a-tiles {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
}

.a-sub { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* The cash box is the dense one, so it takes the wider half. */
.a-two {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: 18px;
  align-items: start;
}

.a-stack { display: flex; flex-direction: column; gap: 18px; min-width: 0; }

.a-error { margin: 0; color: var(--danger); }
.a-muted { margin: 0; color: var(--muted); font-size: 13px; }

.a-skeleton {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
}

.a-skeleton span {
  display: block;
  min-height: 92px;
  border-radius: 12px;
  background: var(--surface-2);
}

@media (max-width: 1279px) {
  .a-tiles, .a-skeleton { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (max-width: 1023px) {
  /* Two-up on a phone, and the two columns become one. */
  .a-tiles, .a-skeleton { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .a-two { grid-template-columns: minmax(0, 1fr); }
}
</style>
