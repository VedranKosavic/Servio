<script setup lang="ts">
/**
 * **S17 *Raspored*** — the waiter's and the šanker's week. Dark kit. Read-only.
 *
 * One component, two routes (`/konobar/raspored`, `/sanker/raspored`): the
 * šanker's back arrow returns to the ticket queue and the waiter's to the floor
 * plan, and that is the only difference between them — the `/sanker/popis`
 * precedent.
 *
 * **Nothing here writes.** Swaps and sick days are gone from the app ("Ne trebaju
 * nam zamjene i bolovanje"): this screen shows the owner's plan, and a change to
 * it is a conversation with him rather than a button. The last answer is cached
 * in IndexedDB (`roster:last`) so a phone in the cellar still shows tonight's
 * shift.
 *
 * **A published raspored repeats every week until a newer one is published**, so
 * a week the owner never touched still has a plan, and the line above the days
 * says which published week it repeats.
 *
 * **A colleague's absence is a hole.** The server sends a waiter a different
 * query, not a filtered one: a colleague the plan no longer counts was never in
 * this response.
 */
import { get as idbGet, set as idbSet } from 'idb-keyval'
import type { Assignment, MyRoster, RosterWeekView } from '#shared/types'

const props = defineProps<{
  /** Where the back arrow goes: `/konobar` for a waiter, `/sanker` for the šanker. */
  backTo: string
}>()

const api = useApi()
const me = useMe()

/** The last good answer, so the screen opens with no signal. */
const CACHE_KEY = 'roster:last'

const data = ref<MyRoster | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const stale = ref(false)

const which = ref<'ova' | 'sljedeca'>('ova')
const SEGMENTS = [
  { value: 'ova', label: 'Ova sedmica' },
  { value: 'sljedeca', label: 'Sljedeća' },
] as const

const week = computed<RosterWeekView | null>(() => {
  if (!data.value) return null
  return which.value === 'ova' ? data.value.this_week : data.value.next_week
})

const myId = computed(() => me.user.value?.id ?? '')

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

  const cached = await idbGet<MyRoster>(CACHE_KEY)
  if (cached) {
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

// -- the day rows -----------------------------------------------------------

interface DayRow {
  work_date: string
  rows: Assignment[]
}

const days = computed<DayRow[]>(() =>
  (week.value?.days ?? []).map(day => ({
    work_date: day.work_date,
    // Newest template first would be wrong: a day reads morning to night.
    rows: [...day.assignments].sort((a, b) => a.start_time.localeCompare(b.start_time)),
  })))

const unpublished = computed(() => !!week.value && week.value.published_at === null)

const mine = computed(() => (week.value ? myShifts(week.value, myId.value) : []))
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

          <!-- Which week. A control, not two primary actions. -->
          <UiSeg
            block
            label="Sedmica"
            :options="SEGMENTS"
            :model-value="which"
            @update:model-value="which = $event as typeof which"
          />

          <p v-if="unpublished" class="empty">
            {{ which === 'sljedeca'
              ? 'Raspored za sljedeću sedmicu još nije objavljen.'
              : 'Raspored za ovu sedmicu još nije objavljen.' }}
          </p>

          <template v-else>
            <!-- A published raspored repeats until a newer one is published, so a
                 week nobody wrote still has a plan — and says whose. -->
            <p v-if="week?.inherited_from" class="text-caption text-muted">
              Važi raspored objavljen za {{ weekRangeBs(week.inherited_from) }}.
            </p>
            <p class="text-label text-text-2">
              {{ which === 'ova' ? 'Moje smjene ove sedmice' : 'Moje smjene sljedeće sedmice' }}:
              <strong class="num text-text">{{ mine.length }}</strong>
            </p>

            <section
              v-for="day in days"
              :key="day.work_date"
              class="card flex flex-col gap-2 p-3"
            >
              <h3 class="text-label font-semibold text-text-2">{{ dayLabelBs(day.work_date) }}</h3>

              <p v-if="!day.rows.length" class="text-label text-muted">Niko nije na rasporedu.</p>

              <div
                v-for="person in day.rows"
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
                  <small class="block text-caption tracking-normal text-muted">{{ person.template_name }}</small>
                </span>

                <span v-if="person.user_id === myId" class="num shrink-0 text-label font-semibold">
                  {{ timeSpanBs(person.start_time, person.end_time) }}
                </span>
              </div>
            </section>
          </template>
        </template>
      </main>
    </div>
  </ClientOnly>
</template>
