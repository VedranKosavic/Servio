<script setup lang="ts">
/**
 * *Smjene* — the period as a list of **days**, newest first, each with the
 * shifts the café runs in a day under it.
 *
 * **A day is two shifts.** The café works *Prva smjena* 07:00–15:00 and *Druga
 * smjena* 15:00–23:00, which is what `shift_templates` holds, so the screen is a
 * date with two cards beneath it and not a flat list of shifts: the owner reads
 * "Thursday made this in the morning and that in the evening", which a row per
 * shift could never say. The grouping and the slot matching are pure functions in
 * `smjena/smjeneDays.ts` — how a shift finds its slot, what happens to one that
 * matches no window, and why a day nobody worked produces nothing are all
 * written there and tested without mounting a component.
 *
 * **One structure at both widths.** The laptop used to get a six-column table;
 * it now gets the same days, with the date as a left-hand column and the two
 * shifts side by side, so eight days still compare down a column at a desk. The
 * phone stacks the two cards. Nothing on this screen scrolls sideways at any
 * width, at either layout.
 *
 * **Two reads, not one.** The shifts come from `GET /api/owner/shifts?from&to`
 * under the period control, the slots from `GET /api/admin/shift-templates` —
 * the venue's own windows, because the two shifts are a café's setting and not a
 * constant this page gets to hard-code. The templates are read once and again
 * when `roster` moves in the change feed; the shifts refetch when `shift` does.
 * There is one poll on `/admin` and this page subscribes to it rather than
 * opening a timer of its own.
 *
 * The period lives in the route query rather than in a `ref`, so a tab the owner
 * leaves open and reloads comes back on the same range, and a link he sends
 * himself opens on it.
 *
 * **`useMounted` is not optional here.** `useMediaQuery` answers truthfully from
 * the first client render, and the server — which has no viewport — always says
 * the laptop. Without the gate the two renders disagree about the period control
 * and Vue throws the server's markup away with a hydration mismatch. So the
 * first paint is the laptop's control at both widths, and the phone swaps to the
 * arrow · period · arrow row on mount, which happens before the first read lands.
 */
import { groupShiftsByDay } from '~/components/smjena/smjeneDays'
import type { OwnerShiftRow, ShiftTemplateView } from '#shared/types'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Smjene' })

const api = useAdminApi()
const route = useRoute()

/** The dashboard's own breakpoint — the width `admin.css` changes density at. */
const mounted = useMounted()
const narrow = useMediaQuery('(max-width: 1023px)')
const isPhone = computed(() => mounted.value && narrow.value)

/**
 * Both period controls build their own `useAdminPeriod()` with the kit's
 * default, so this page must use the same default or the control and the range
 * would disagree. A week is the more useful opening range here, so instead of a
 * different fallback the page *writes* one into the query the first time it is
 * opened — every instance then reads the same URL.
 */
const period = useAdminPeriod()

onMounted(() => {
  if (!route.query.period && !route.query.from) period.setPeriod('ova-sedmica')
})

const rows = ref<OwnerShiftRow[]>([])
const templates = ref<ShiftTemplateView[]>([])
const loadingShifts = ref(true)
const loadingTemplates = ref(true)
const error = ref('')

/**
 * The first paint waits for both reads.
 *
 * Without the templates a shift has no slot to sit in, so drawing the days a
 * moment early would label every card *Smjena* and then rename it to *Prva
 * smjena* under the owner's thumb. A later period change does **not** raise this
 * again: the days that are on screen stay there while the next range loads.
 */
const loading = computed(() => loadingShifts.value || loadingTemplates.value)

async function load() {
  try {
    rows.value = await api.getShifts(period.range.value)
    error.value = ''
  } catch (err) {
    // An honest empty screen: a stale list of takings is worse than none.
    error.value = apiErrorText(err)
  } finally {
    loadingShifts.value = false
  }
}

/**
 * The venue's shifts. A failure here is deliberately **not** an error on the
 * screen: every shift still gets a card, named *Smjena* instead of *Prva
 * smjena*, and no number changes. A red sentence over a correct pazar would say
 * the takings are in doubt when only their labels are.
 */
async function loadTemplates() {
  try {
    templates.value = await api.getShiftTemplates()
  } catch {
    templates.value = []
  } finally {
    loadingTemplates.value = false
  }
}

watch(period.range, load, { immediate: true })

onMounted(() => { void loadTemplates() })

useAdminChanges({
  onEntity: (entity) => {
    if (entity === 'shift') void load()
    // Template CRUD bumps `roster` (`server/services/roster.ts`), so a window
    // the owner moves on *Raspored* re-slots these cards without a reload.
    if (entity === 'roster') void loadTemplates()
  },
})

/** The days in the period, each with its slots — the whole screen's shape. */
const days = computed(() => groupShiftsByDay(rows.value, templates.value))

/**
 * What the period adds up to. Summed from the rows the read returned and not
 * from the days, so the number at the top is the server's answer — and since
 * every row lands on exactly one card, it is also the sum of what is on screen.
 */
const total = computed(() => rows.value.reduce((sum, row) => sum + row.promet_fen, 0))
</script>

<template>
  <div class="a-page">
    <UiPageHead eyebrow="Lokal" title="Smjene" sub="Svaki dan, i šta je od njega ostalo u kasi" />

    <!-- ---- the phone ------------------------------------------------- -->
    <SmjenaPeriod v-if="isPhone" />

    <!-- ---- the laptop ------------------------------------------------ -->
    <UiCard v-else quiet>
      <UiPeriod />
    </UiCard>

    <p v-if="error" class="a-error">{{ error }}</p>

    <SmjenaDays :days="days" :shifts="rows.length" :loading="loading" :total="total" />
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

.a-error { margin: 0; color: var(--danger); font-size: var(--text-label); }
</style>
