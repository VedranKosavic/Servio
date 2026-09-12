<script setup lang="ts">
/**
 * *Prodano* — what one shift has sold, by article.
 *
 * This is what the shift card on *Puls* opens. The owner's words: *"When clicked
 * on the current shift, we open up a new tab and we show all the items counter of
 * the current live state (how much was sold currently in that shift)."* So it is a
 * counter: one row per article with the quantity and the money, most sold first —
 * not the list of individual rounds, which is a different question and already has
 * its own screen on *Smjena*.
 *
 * **No new endpoint.** `GET /api/owner/shift/:id/lines` already answers every line
 * of a shift, paged on a keyset cursor, and folding them by article is arithmetic
 * a browser can do (`soldRows()` in `app/utils/puls.ts`). A route that returned
 * this shape would be a route to declare, guard and test for a sum of two columns.
 * `GET /api/owner/shift/:id` comes with it for the head — which shift, which night,
 * and whether it is still running.
 *
 * **The shift is a query and not a path segment** (`?id=…`), because *Puls* is one
 * tap away and a drill-down that spells its subject in the query is one page file
 * rather than a folder — and `UiPageHead` finds its way back to *Puls* either way.
 *
 * **It follows the one poll.** The shift being looked at is usually the one that is
 * running, so a counter that froze the moment it opened would be the wrong screen
 * for the question. It subscribes to `useAdminChanges()` — the dashboard's single
 * 15 s timer, not a second one — and re-reads when a round, a shift or an
 * adjustment moves.
 */
import type { LineRow, OwnerShift } from '#shared/types'
import type { SoldRow } from '~/utils/puls'
import { localTime } from '#shared/dates'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Prodano' })

const route = useRoute()
const api = useAdminApi()

const shiftId = computed(() => String(route.query.id ?? ''))

const shift = ref<OwnerShift | null>(null)
const rows = ref<SoldRow[]>([])
const loading = ref(true)
const truncated = ref(false)
const error = ref('')

/** The same list the *Šabloni* screen reads, cached under one key per visit. */
const { data: templates } = useAsyncData(
  'admin:shift-templates',
  () => api.getShiftTemplates(),
  { server: false, default: () => [] },
)

/**
 * A guard on the paging loop: 20 pages of 100 lines is 2 000 rounds, which is
 * more than a night has ever had. Reaching it says so in the foot rather than
 * quietly reporting a total that is missing its tail.
 */
const MAX_PAGES = 20

/**
 * Every line of the shift, folded by article.
 *
 * The cursor is a **keyset** — it names the last row of the page we hold and the
 * server answers with what comes after it — so paging cannot skip a round that
 * lands mid-read the way an offset would.
 */
async function loadLines() {
  if (!shiftId.value) {
    error.value = 'Smjena nije izabrana.'
    loading.value = false
    return
  }

  try {
    const lines: LineRow[] = []
    let cursor: string | undefined
    let pages = 0

    do {
      const page = await api.getShiftLines(shiftId.value, {
        kat: 'sve',
        ...(cursor ? { cursor } : {}),
      })
      lines.push(...page.rows)
      cursor = page.next_cursor
      pages += 1
    } while (cursor && pages < MAX_PAGES)

    rows.value = soldRows(lines)
    truncated.value = Boolean(cursor)
    error.value = ''
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

async function loadShift() {
  if (!shiftId.value) return
  try {
    shift.value = await api.getShift(shiftId.value)
  } catch (err) {
    // The counter is the page; a head without a date is a smaller loss than an
    // error over numbers that did arrive.
    if (!error.value) error.value = apiErrorText(err)
  }
}

const totals = computed(() => soldTotals(rows.value))

/** Which shift this was, named by the template that owned the minute it opened. */
const shiftWindow = computed(() => (shift.value
  ? shiftWindowFor(templates.value ?? [], localTime(shift.value.shift.opened_at))
  : null))

/** "Prva smjena · 07–15 · sub 12.09.2026. · 07:02–15:04" */
const sub = computed(() => {
  const row = shift.value?.shift
  if (!row) return ''
  const clockSpan = [timeBs(row.opened_at), row.closed_at ? timeBs(row.closed_at) : '']
  return [
    shiftWindow.value?.name,
    shiftWindow.value?.hours,
    `${weekdayBs(row.business_date)} ${dateBs(row.business_date)}`,
    row.closed_at ? clockSpan.join('–') : `od ${clockSpan[0]}`,
  ].filter(Boolean).join(' · ')
})

onMounted(async () => {
  await Promise.all([loadShift(), loadLines()])
})

// The dashboard's one timer. A round is written as `table`; a storno decided on
// the bar is `adjustment`; a close is `shift` — and each of the three changes what
// this page says.
useAdminChanges({
  onEntity: (entity) => {
    if (entity === 'table' || entity === 'shift' || entity === 'adjustment') {
      void loadLines()
    }
  },
})
</script>

<template>
  <div class="a-page">
    <!-- No back link of this page's own: `UiPageHead` draws the way back on every
         screen that is not a tab destination, and from here it climbs to Puls. -->
    <UiPageHead title="Prodano" :sub="sub" />

    <p v-if="error" class="a-error">{{ error }}</p>

    <PulsProdano
      :rows="rows"
      :totals="totals"
      :loading="loading"
      :truncated="truncated"
    />
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

.a-error { margin: 0; color: var(--danger); font-size: var(--text-label); }

@media (min-width: 1024px) {
  .a-page { max-width: 760px; }
}

/* The layout's *Razgovor* button floats over the bottom-right corner of every
   dashboard screen, so the list ends clear of it instead of under it. */
@media (max-width: 1023px) {
  .a-page { padding-bottom: 72px; }
}
</style>
