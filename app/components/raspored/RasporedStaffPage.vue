<script setup lang="ts">
/**
 * **S17 *Raspored*** — the waiter's and the šanker's week. Dark kit. Read-only.
 *
 * One component, two routes (`/konobar/raspored`, `/sanker/raspored`): the
 * šanker's back arrow returns to the ticket queue and the waiter's to the floor
 * plan, and that is the only difference between them.
 *
 * **One weekly pattern, no dates.** The owner's plan is seven weekdays × shifts
 * and it repeats every week until he changes it, so this screen is seven day
 * cards, Monday first, with my own shifts in the accent colour. Nothing here
 * writes. The last answer is cached in IndexedDB so a phone in the cellar still
 * shows tonight's shift — under a new key (`roster:pattern`), because the dated
 * roster's old cache has a different shape.
 */
import { get as idbGet, set as idbSet } from 'idb-keyval'
import { WEEKDAYS, businessDate, isoWeekday, weekdayLongBs } from '#shared/dates'
import { dayCells, myPatternShifts, timeSpanBs } from '~/composables/useRoster'
import type { RosterPatternView } from '#shared/types'

const props = defineProps<{
  /** Where the back arrow goes: `/konobar` for a waiter, `/sanker` for the šanker. */
  backTo: string
}>()

const api = useApi()
const me = useMe()

/** The last good answer, so the screen opens with no signal. */
const CACHE_KEY = 'roster:pattern'

const data = ref<RosterPatternView | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const stale = ref(false)

const myId = computed(() => me.user.value?.id ?? '')

/** Today's weekday on the café's business day: at 01:30 it is still yesterday. */
const today = computed(() => isoWeekday(businessDate(
  new Date().toISOString(),
  me.settings.value?.timezone,
  me.settings.value?.business_day_start_hour,
)))

async function load() {
  try {
    const fresh = await api.getMyRoster()
    data.value = fresh
    stale.value = false
    error.value = null
    await idbSet(CACHE_KEY, fresh)
  } catch (err) {
    if (await me.handleAuthError(err)) return
    // A cached week is better than an empty screen — but it says it is old.
    if (data.value) stale.value = true
    else error.value = apiErrorText(err, 'Nema veze — raspored nije učitan.')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (!(await me.requireSession())) return

  const cached = await idbGet<RosterPatternView>(CACHE_KEY)
  if (cached?.entries && cached.templates) {
    data.value = cached
    stale.value = true
    loading.value = false
  }
  await load()
})

// One poll, 15 s, the same as every other screen. `roster` is the only entity
// this page cares about; a round somebody locks downstairs changes nothing here.
useChanges({
  raw: (result) => {
    if (!result.full && result.changes.some(c => c.entity === 'roster')) void load()
  },
})

const days = computed(() => WEEKDAYS.map(weekday => ({
  weekday,
  label: weekdayLongBs(weekday),
  isToday: weekday === today.value,
  // Only the shifts somebody is on: an empty shift is noise on a staff phone.
  cells: data.value ? dayCells(data.value, weekday).filter(c => c.people.length) : [],
})))

const mine = computed(() => (data.value ? myPatternShifts(data.value, myId.value) : []))
</script>

<template>
  <ClientOnly>
    <div class="flex flex-1 flex-col">
      <WaiterHeader title="Raspored" :back-to="props.backTo" />

      <main class="flex flex-1 flex-col gap-3 py-4">
        <p v-if="loading" class="py-10 text-center text-text-2">Učitavanje…</p>

        <div v-else-if="error" class="card flex flex-col gap-3 p-4 text-center">
          <p class="text-danger">{{ error }}</p>
          <button type="button" class="btn btn-ghost" @click="load">Pokušaj ponovo</button>
        </div>

        <template v-else>
          <p v-if="stale" class="chip chip-warn self-start">
            Nema veze — prikazan je posljednji preuzeti raspored
          </p>

          <p class="text-caption text-muted">Raspored važi svake sedmice.</p>
          <p class="text-label text-text-2">
            Moje smjene u sedmici:
            <strong class="num text-text">{{ mine.length }}</strong>
          </p>

          <section
            v-for="day in days"
            :key="day.weekday"
            class="card flex flex-col gap-2 p-3"
          >
            <h3 class="flex items-center gap-2 text-label font-semibold text-text-2">
              {{ day.label }}
              <span v-if="day.isToday" class="chip">danas</span>
            </h3>

            <p v-if="!day.cells.length" class="text-label text-muted">Niko nije na rasporedu.</p>

            <template v-for="cell in day.cells" :key="cell.template.id">
              <div
                v-for="person in cell.people"
                :key="person.id"
                class="flex min-h-12 items-center gap-3 rounded-control px-2"
                :class="person.user_id === myId
                  ? 'bg-accent/15 text-text'
                  : 'text-text-2'"
              >
                <span
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-label font-bold"
                  :class="person.user_id === myId
                    ? 'bg-accent text-accent-ink'
                    : 'bg-surface-2 text-text-2'"
                >{{ person.user_initials }}</span>

                <span class="grow truncate">
                  {{ person.user_name }}
                  <small class="block text-caption tracking-normal text-muted">{{ cell.template.name }}</small>
                </span>

                <span v-if="person.user_id === myId" class="num shrink-0 text-label font-semibold">
                  {{ timeSpanBs(cell.template.start_time, cell.template.end_time) }}
                </span>
              </div>
            </template>
          </section>
        </template>
      </main>
    </div>
  </ClientOnly>
</template>
