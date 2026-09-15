<script setup lang="ts">
/**
 * *Sedmica* — the owner's week. `/admin`, light kit.
 *
 * **A published week repeats every week until a newer one is published** — the
 * owner's rule, kept by the server at read time. A week with no rows of its own
 * arrives with `inherited_from` set and its cells marked `inherited`: the pill
 * says *važi od 14.09.*, *Objavi raspored* has nothing to do, and the first edit
 * writes that week down as a draft of its own (the server does it; this screen
 * only sends `work_date` with an inherited cell's id). So a typical week is no
 * taps at all, and a changed one is its fixes plus *Objavi raspored*. That is why
 * the picker stays open and why the week-level button sits in the header rather
 * than behind a menu.
 *
 * Two refusals the server makes and this screen has to speak for:
 *
 * - **`409 OVERLAP`** — one person, two templates that overlap on one date.
 *   Refused with **no override**: a person cannot be in two places at once.
 * - **`409 DOUBLE_SHIFT`** — a second, non-overlapping template the same day.
 *   Asked once, in a sheet, and the retry carries `force_double`.
 *
 * The week refetches on `roster` moving in the change feed and on nothing else:
 * there is one poll on `/admin` and this subscribes to it (`useAdminChanges`).
 */
import { weekCells, alreadyThatDay } from '~/composables/useRoster'
import { shortDateBs } from '#shared/dates'
import type { ApiSideError } from '~/composables/useApi'
import type { Assignment, RosterWeekView, UserAdmin } from '#shared/types'

const props = defineProps<{ today: string }>()

const api = useAdminApi()
const week = useRosterWeek(props.today)

const view = ref<RosterWeekView | null>(null)
const people = ref<UserAdmin[]>([])
const loading = ref(true)
const error = ref('')
const busy = ref(false)

const rows = computed(() => (view.value ? weekCells(view.value) : []))
/** True on an inherited week too: its plan is in force, there is nothing to publish. */
const published = computed(() => !!view.value?.published_at)
/** The Monday of the published week this one repeats, or `null`. */
const inheritedFrom = computed(() => view.value?.inherited_from ?? null)

async function load() {
  try {
    view.value = (await api.getRoster(week.monday.value, week.monday.value))[0] ?? null
    error.value = ''
  } catch (err) {
    // An honest empty screen: a stale week is worse than none — somebody would
    // come in on a day he is no longer on.
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

watch(week.monday, () => { loading.value = true; void load() })

const changes = useAdminChanges({
  onEntity: (entity) => { if (entity === 'roster') void load() },
})

// -- the week button --------------------------------------------------------

async function run(action: () => Promise<unknown>) {
  busy.value = true
  error.value = ''
  try {
    await action()
    await load()
    // Do not wait out the 15 s: every other screen should see this now.
    await changes.refresh()
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    busy.value = false
  }
}

const publish = () => run(() => api.publishRosterWeek(week.monday.value))

// -- the picker -------------------------------------------------------------

const picking = ref<{ work_date: string, template_id: string } | null>(null)
const pickError = ref<string | null>(null)
const pickedNow = ref<string[]>([])
const pendingId = ref<string | null>(null)

/** The `409 DOUBLE_SHIFT` retry, asked once and carrying the name it is about. */
const doubleAsk = ref<{ userId: string, name: string } | null>(null)

const pickerTitle = computed(() => {
  if (!picking.value || !view.value) return 'Dodaj u smjenu'
  const template = view.value.templates.find(t => t.id === picking.value!.template_id)
  return `${template?.name ?? 'Smjena'} · ${dayLabelBs(picking.value.work_date)}`
})

const pickerBusy = computed(() =>
  (picking.value && view.value)
    ? alreadyThatDay(view.value, picking.value.work_date)
    : new Map<string, string>())

const pickerTaken = computed(() => {
  if (!picking.value || !view.value) return new Set<string>()
  const day = view.value.days.find(d => d.work_date === picking.value!.work_date)
  return new Set((day?.assignments ?? [])
    .filter(a => a.template_id === picking.value!.template_id
      && a.status !== 'removed' && a.status !== 'swapped')
    .map(a => a.user_id))
})

function openPicker(workDate: string, templateId: string) {
  picking.value = { work_date: workDate, template_id: templateId }
  pickError.value = null
  pickedNow.value = []
}

function closePicker() {
  picking.value = null
  doubleAsk.value = null
}

async function pick(userId: string, forceDouble = false) {
  if (!picking.value) return
  pendingId.value = userId
  pickError.value = null
  try {
    await api.addAssignment({
      work_date: picking.value.work_date,
      template_id: picking.value.template_id,
      user_id: userId,
      ...(forceDouble ? { force_double: true } : {}),
    })
    pickedNow.value = [...pickedNow.value, userId]
    doubleAsk.value = null
    await load()
    await changes.refresh()
  } catch (err) {
    const code = (err as ApiSideError)?.code
    if (code === 'DOUBLE_SHIFT' && !forceDouble) {
      // Asked once. `OVERLAP` deliberately has no branch here: it is refused.
      doubleAsk.value = { userId, name: people.value.find(p => p.id === userId)?.name ?? '' }
    } else {
      pickError.value = apiErrorText(err)
    }
  } finally {
    pendingId.value = null
  }
}

// -- one cell ---------------------------------------------------------------

const cell = ref<Assignment | null>(null)
const cellError = ref<string | null>(null)

function openCell(person: Assignment) {
  cell.value = person
  cellError.value = null
}

const cellPast = computed(() => !!cell.value && cell.value.work_date < props.today)

async function cellRun(action: () => Promise<unknown>) {
  busy.value = true
  cellError.value = null
  try {
    await action()
    cell.value = null
    await load()
    await changes.refresh()
  } catch (err) {
    cellError.value = apiErrorText(err)
  } finally {
    busy.value = false
  }
}

/**
 * An inherited cell has no row of its own: its `id` is the source week's row, so
 * *Ukloni* carries the date that was tapped and the server writes that week down
 * as a draft before it takes the person off.
 */
const tappedDate = () => (cell.value?.inherited ? cell.value.work_date : undefined)

const removeCell = () => cellRun(() => api.removeAssignment(cell.value!.id, tappedDate()))
</script>

<template>
  <div class="r-tab">
    <!-- `r-bar`: on a phone this card sheds its chrome and becomes the one
         compact bar the week is steered from. See the style block. -->
    <UiCard class="r-bar">
      <div class="r-head">
        <div class="r-nav">
          <UiButton variant="soft" aria-label="Prethodna sedmica" @click="week.go(-1)">‹</UiButton>
          <div class="r-when">
            <strong>{{ week.label.value }}</strong>
            <UiPill v-if="inheritedFrom" tone="good">
              važi od {{ shortDateBs(inheritedFrom) }}
            </UiPill>
            <UiPill v-else :tone="published ? 'good' : 'neutral'">
              {{ published ? 'objavljeno' : 'nacrt' }}
            </UiPill>
          </div>
          <UiButton variant="soft" aria-label="Sljedeća sedmica" @click="week.go(1)">›</UiButton>
        </div>

        <div class="r-acts">
          <UiButton variant="primary" :pending="busy" :disabled="published" @click="publish">
            Objavi raspored
          </UiButton>
        </div>
      </div>

      <p v-if="inheritedFrom" class="r-quiet">
        Nastavak rasporeda objavljenog za {{ weekRangeBs(inheritedFrom) }}. Prva izmjena
        pravi nacrt ove sedmice, a telefoni ga vide tek kad ga objaviš.
      </p>
      <p v-else-if="view?.published_at && view.published_by_name" class="r-quiet">
        Objavio {{ view.published_by_name }} · {{ dateTimeBs(view.published_at) }}.
        Ponavlja se svake sedmice dok ne objaviš novi raspored.
      </p>
      <p v-else class="r-quiet">
        Nacrt vidi samo vlasnik, a telefoni i dalje vide posljednji objavljeni raspored.
        Objavljeni raspored se ponavlja svake sedmice dok ne objaviš novi.
      </p>

      <p v-if="error" class="r-error" role="alert">{{ error }}</p>
    </UiCard>

    <UiCard v-if="loading">
      <p class="r-quiet">Učitavanje…</p>
    </UiCard>

    <!-- The laptop grid first, the phone's week second, and that order matters:
         only one of the two is ever on screen, and a locator looking for a name
         should find the visible one. -->
    <template v-else-if="view">
      <RasporedGrid :week="view" :rows="rows" :today="today" @add="openPicker" @open="openCell" />
      <RasporedPhoneWeek :week="view" :rows="rows" :today="today" @add="openPicker" @open="openCell" />
    </template>

    <RasporedPicker
      :open="!!picking && !doubleAsk"
      :title="pickerTitle"
      :people="people"
      :busy="pickerBusy"
      :taken="pickerTaken"
      :pending-id="pendingId"
      :error="pickError"
      :done="pickedNow"
      @close="closePicker"
      @pick="id => pick(id)"
    />

    <!-- Asked once, and the retry is the only place `force_double` is sent. -->
    <UiSheet
      :open="!!doubleAsk"
      title="Dupla smjena"
      action="Svejedno dodaj"
      :pending="!!pendingId"
      @close="doubleAsk = null"
      @confirm="pick(doubleAsk!.userId, true)"
    >
      <p class="r-ask">
        {{ doubleAsk?.name }} već radi jednu smjenu tog dana. Smjene se ne
        preklapaju, ali je to dupla smjena.
      </p>
    </UiSheet>

    <RasporedCellSheet
      :open="!!cell"
      :person="cell"
      :past="cellPast"
      :pending="busy"
      :error="cellError"
      @close="cell = null"
      @remove="removeCell"
    />
  </div>
</template>

<style scoped>
.r-tab { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

.r-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.r-nav { display: flex; align-items: center; gap: 8px; }
.r-when { display: flex; align-items: center; gap: 8px; }
.r-when strong { font-variant-numeric: tabular-nums; font-size: var(--text-body); }
.r-acts { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }

.r-quiet { margin: 0; color: var(--muted); font-size: var(--text-micro); }
.r-error { margin: 0; color: var(--danger); font-weight: 500; }
.r-ask { margin: 0; }

/**
 * The phone: one bar, not a card with a paragraph in it.
 *
 * The head used to cost the top third of a 390 px screen before a single day
 * appeared — a card's border and 30 px of padding around a nav row, two
 * full-width buttons stacked because their labels would not share a line, and a
 * two-line explanation. Below the breakpoint the card sheds its chrome and the
 * three parts become what they are: a week stepper in its own well, the two
 * week-level actions on one line, and the explanation at caption size.
 *
 * Nothing is duplicated to do it and nothing is hidden: the same two buttons and
 * the same sentence are on both layouts, so a locator finds exactly one of each.
 */
@media (max-width: 1023px) {
  /* `.a-card.r-bar` rather than `.r-bar` alone: one class more than `UiCard`'s
     own rule, so the override does not depend on stylesheet order. */
  .r-tab :deep(.a-card.r-bar) {
    border: 0;
    box-shadow: none;
    background: transparent;
    padding: 0;
  }

  .r-tab :deep(.a-card.r-bar .a-card-body) { gap: 8px; }

  .r-head { gap: 8px; }

  /* The stepper is the one piece of furniture here, so it keeps a material of
     its own: the ‹ and › sit at the ends and the week reads in the middle. */
  .r-nav {
    width: 100%;
    justify-content: space-between;
    gap: 8px;
    padding: 4px;
    border: 1px solid var(--line);
    border-radius: var(--radius-card);
    background: var(--surface);
    box-shadow: var(--shadow-card);
  }

  .r-when { flex-wrap: wrap; justify-content: center; }
  .r-when strong { font-size: var(--text-section); }

  /* *Objavi raspored* is the one week-level action, and on a phone it takes the
     whole line. */
  .r-acts {
    margin-left: 0;
    width: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }

  .r-acts :deep(.a-btn) { padding: 0 10px; min-width: 0; }

  .r-quiet { font-size: var(--text-caption); line-height: 1.35; }
}
</style>
