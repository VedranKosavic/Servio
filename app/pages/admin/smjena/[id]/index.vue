<script setup lang="ts">
/**
 * *Smjena* — one night, top to bottom.
 *
 * Everything on this page comes from **one** read, `GET /api/owner/shift/:id`,
 * which answers the shift, its written summary, the per-waiter fold, the
 * šanker's closing and what arrived after closing. The second read is
 * `GET /api/admin/settings`, which the waiter strip judges against.
 *
 * **The owner's cut.** The tiles are down to *Pazar*: gotovina/kartica, gratis
 * and storna, razlika gotovine, manjak robe and lule went, and so did *Popisi*.
 * *Kasa* is no longer the drawer reconciliation — nobody counts cash any more —
 * it is the šanker's *Zaključi smjenu*: Sav prihod, the deductions and
 * *Za predati*, exactly as stored.
 *
 * The refetch is the shell's poll (`useAdminChanges`), narrowed to the entities
 * that can change what is on this page. There is no `setInterval` here.
 */
import { ApiSideError } from '~/composables/useApi'
import type { OwnerShift, Settings } from '#shared/types'

definePageMeta({ middleware: 'admin', layout: 'admin' })

const route = useRoute()
const api = useAdminApi()
const me = useMe()
const changes = useAdminChanges({
  onEntity: (entity) => {
    if (entity === 'shift' || entity === 'adjustment' || entity === 'stock') void load()
  },
})

const shiftId = computed(() => String(route.params.id))

const data = ref<OwnerShift | null>(null)
const settings = ref<Settings | null>(null)
const loading = ref(true)
const error = ref('')

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
 * The read happens in the browser, not during the server render: the session
 * is a httpOnly cookie and a server-side `$fetch` would go out without it.
 */
onMounted(load)

useHead({
  title: () => data.value ? `Smjena ${dateBs(data.value.shift.business_date)}` : 'Smjena',
})

/**
 * `user_id` → name, from the rows this page already holds, so the header never
 * renders a UUID for `closed_by` or `reviewed_by`.
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
  if (shift.closing) map[shift.closing.closed_by] = shift.closing.closed_by_name
  return map
})

/**
 * `category_id` → name, from the one fold that has them: `summary.by_category`
 * comes back named, `by_user[].by_category` does not.
 */
const categoryNames = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {}
  for (const line of data.value?.summary.by_category ?? []) {
    if (line.name) map[line.category_id] = line.name
  }
  return map
})

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
    // 422 NOTE_REQUIRED: the server wants a sentence before it signs the night off.
    if (err instanceof ApiSideError && err.code === 'NOTE_REQUIRED') noteRequired.value = true
    reviewError.value = apiErrorText(err)
  } finally {
    reviewPending.value = false
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
        <UiTile label="Pazar" :value="formatAmount(data.summary.promet_fen)" unit="KM" />
      </div>

      <!-- *Kasa* is the šanker's close: Sav prihod, the deductions, Za predati. -->
      <SmjenaClosingCard :closing="data.closing ?? null" />

      <SmjenaWaiterStrip
        :shift-id="data.shift.id"
        :users="data.by_user"
        :settlements="data.settlements"
        :settings="settings"
        :category-names="categoryNames"
      />

      <SmjenaCategoryBar :shift-id="data.shift.id" :categories="data.summary.by_category" />

      <SmjenaAfterClose :late="data.late_after_close" />
    </template>

    <!-- A skeleton, not a spinner over stale numbers. -->
    <div v-else-if="loading" class="a-skeleton">
      <span v-for="n in 3" :key="n" />
    </div>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 18px; min-width: 0; }

/* One tile now; the grid keeps it the width a tile has always had. */
.a-tiles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.a-error { margin: 0; color: var(--danger); }

.a-skeleton {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.a-skeleton span {
  display: block;
  min-height: 92px;
  border-radius: 12px;
  background: var(--surface-2);
}

@media (max-width: 1023px) {
  .a-tiles, .a-skeleton { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
