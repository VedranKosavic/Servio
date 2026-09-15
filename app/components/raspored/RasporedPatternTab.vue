<script setup lang="ts">
/**
 * The owner's *Raspored* — one weekly pattern. `/admin`, light kit.
 *
 * **No dates, nothing to publish.** The owner's rule: "Ne trebaju nam datumi za
 * raspored, samo nam treba da dodamo po danima maksimalno 2 osobe po smjeni i
 * taj raspored ostaje zauvijek." A tap on `+` and a name saves the person into
 * that weekday's shift for every week; a tap on a name and *Ukloni sa smjene*
 * takes him out. Every phone sees the change on its next poll.
 *
 * **Two per shift, on both sides.** The server refuses a third person
 * (`409 SHIFT_FULL`) and the same person twice (`409 ALREADY_IN_SHIFT`); this
 * screen hides the `+` on a full cell and disables the names already in it, so
 * the refusal is only ever seen by a second owner racing the first.
 *
 * The pattern refetches on `roster` moving in the change feed and on nothing
 * else: there is one poll on `/admin` and this subscribes to it.
 */
import { weekdayLongBs } from '#shared/dates'
import {
  ROSTER_HINT_BS, alreadyThatWeekday, dayCells, patternCells,
} from '~/composables/useRoster'
import type { PatternEntry, RosterPatternView, UserAdmin } from '#shared/types'

const props = defineProps<{
  /** Today's weekday (ISO, pon = 1) on the café's business day, for the highlight. */
  today: number
}>()

const api = useAdminApi()

const view = ref<RosterPatternView | null>(null)
const people = ref<UserAdmin[]>([])
const loading = ref(true)
const error = ref('')
const busy = ref(false)

const cells = computed(() => (view.value ? patternCells(view.value) : []))

async function load() {
  try {
    view.value = await api.getRosterPattern()
    error.value = ''
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await load()
  try {
    people.value = (await api.getUsers()).filter(u => u.active)
  } catch { /* the picker says "Nema aktivnog osoblja"; the week still draws. */ }
})

const changes = useAdminChanges({
  onEntity: (entity) => { if (entity === 'roster') void load() },
})

// -- the picker -------------------------------------------------------------

const picking = ref<{ weekday: number, template_id: string } | null>(null)
const pickError = ref<string | null>(null)
const pickedNow = ref<string[]>([])
const pendingId = ref<string | null>(null)

const pickedCell = computed(() => {
  if (!picking.value || !view.value) return null
  return dayCells(view.value, picking.value.weekday)
    .find(c => c.template.id === picking.value!.template_id) ?? null
})

const pickerTitle = computed(() => {
  if (!pickedCell.value) return 'Dodaj u smjenu'
  return `${pickedCell.value.template.name} · ${weekdayLongBs(pickedCell.value.weekday)}`
})

const pickerBusy = computed(() =>
  (picking.value && view.value)
    ? alreadyThatWeekday(view.value, picking.value.weekday)
    : new Map<string, string>())

const pickerTaken = computed(() => new Set((pickedCell.value?.people ?? []).map(p => p.user_id)))

function openPicker(weekday: number, templateId: string) {
  picking.value = { weekday, template_id: templateId }
  pickError.value = null
  pickedNow.value = []
}

async function pick(userId: string) {
  if (!picking.value) return
  pendingId.value = userId
  pickError.value = null
  try {
    await api.addToPattern({
      weekday: picking.value.weekday,
      template_id: picking.value.template_id,
      user_id: userId,
    })
    pickedNow.value = [...pickedNow.value, userId]
    await load()
    // Do not wait out the 15 s: every other screen should see this now.
    await changes.refresh()
  } catch (err) {
    pickError.value = apiErrorText(err)
  } finally {
    pendingId.value = null
  }
}

// -- one person -------------------------------------------------------------

const cell = ref<PatternEntry | null>(null)
const cellError = ref<string | null>(null)

const cellTemplate = computed(() =>
  view.value?.templates.find(t => t.id === cell.value?.template_id))

function openCell(person: PatternEntry) {
  cell.value = person
  cellError.value = null
}

async function removeCell() {
  if (!cell.value) return
  busy.value = true
  cellError.value = null
  try {
    await api.removeFromPattern(cell.value.id)
    cell.value = null
    await load()
    await changes.refresh()
  } catch (err) {
    cellError.value = apiErrorText(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="r-tab">
    <UiCard class="r-bar">
      <p class="r-quiet">{{ ROSTER_HINT_BS }}</p>
      <p v-if="error" class="r-error" role="alert">{{ error }}</p>
    </UiCard>

    <UiCard v-if="loading">
      <p class="r-quiet">Učitavanje…</p>
    </UiCard>

    <!-- The laptop grid first, the phone's week second, and that order matters:
         only one of the two is ever on screen, and a locator looking for a name
         should find the visible one. -->
    <template v-else-if="view">
      <RasporedGrid
        :view="view" :cells="cells" :today="props.today"
        @add="openPicker" @open="openCell"
      />
      <RasporedPhoneWeek
        :view="view" :today="props.today"
        @add="openPicker" @open="openCell"
      />
    </template>

    <RasporedPicker
      :open="!!picking"
      :title="pickerTitle"
      :people="people"
      :busy="pickerBusy"
      :taken="pickerTaken"
      :full="pickedCell?.full ?? false"
      :pending-id="pendingId"
      :error="pickError"
      :done="pickedNow"
      @close="picking = null"
      @pick="id => pick(id)"
    />

    <RasporedCellSheet
      :open="!!cell"
      :person="cell"
      :template="cellTemplate"
      :pending="busy"
      :error="cellError"
      @close="cell = null"
      @remove="removeCell"
    />
  </div>
</template>

<style scoped>
.r-tab { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

.r-quiet { margin: 0; color: var(--muted); font-size: var(--text-micro); }
.r-error { margin: 0; color: var(--danger); font-weight: 500; }

/* The phone: the hint is one caption line, not a card with a paragraph in it. */
@media (max-width: 1023px) {
  /* `.a-card.r-bar` rather than `.r-bar` alone: one class more than `UiCard`'s
     own rule, so the override does not depend on stylesheet order. */
  .r-tab :deep(.a-card.r-bar) {
    border: 0;
    box-shadow: none;
    background: transparent;
    padding: 0;
  }

  .r-quiet { font-size: var(--text-caption); line-height: 1.35; }
}
</style>
