<script setup lang="ts">
/**
 * **S17 *Raspored*** — the waiter's and the bartender's week. Dark kit.
 *
 * One component, two routes (`/konobar/raspored`, `/sanker/raspored`): the
 * šanker's back arrow returns to the ticket queue and the waiter's to the floor
 * plan, and that is the only difference between them — the `/sanker/popis`
 * precedent.
 *
 * **The screen opens offline, and every write is online-only.** The last answer
 * is cached in IndexedDB (`roster:last`) so a phone in the cellar still shows
 * tonight's shift; but *Traži zamjenu* and *Preuzimam* are disabled with "Nema
 * veze", exactly like *Premjesti sto*. A swap is not urgent, and a queued one
 * would need server-side conflict rules — who gets the shift when two phones
 * reconnect at once — for no gain. Chat and money queue; this does not.
 *
 * **A colleague's `sick` is a hole.** The server sends a waiter a different
 * query, not a filtered one: a colleague marked ill was never in this response.
 * His own rows keep their status, because he typed the reason himself.
 */
import { get as idbGet, set as idbSet } from 'idb-keyval'
import { useOnline } from '@vueuse/core'
import type { LoginUser, MyRoster, RosterWeekView, SwapRequestView, Assignment } from '#shared/types'

const props = defineProps<{
  /** Where the back arrow goes: `/konobar` for a waiter, `/sanker` for the šanker. */
  backTo: string
}>()

const api = useApi()
const me = useMe()
const online = useOnline()

/** The last good answer, so the screen opens with no signal. */
const CACHE_KEY = 'roster:last'

const data = ref<MyRoster | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const stale = ref(false)
const busy = ref(false)
const actionError = ref<string | null>(null)

/**
 * The names *Traži zamjenu* may aim at.
 *
 * `GET /api/auth/users` — the same list the lock screen draws, and the only
 * roster of colleagues a waiter's session is allowed to read. Deriving it from
 * the visible week would offer only the people already on it, which is the
 * opposite of what a person handing over a shift needs.
 */
const team = ref<LoginUser[]>([])

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
  try {
    team.value = await api.getLoginUsers()
  } catch { /* offline: the sheet still offers *Svima*. */ }

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

// -- the sheets -------------------------------------------------------------

/** My own shift, tapped: *Traži zamjenu*. */
const asking = ref<Assignment | null>(null)
/** Somebody else's open request, tapped: *Preuzimam*. */
const taking = ref<SwapRequestView | null>(null)
const doubleAsk = ref(false)

function tap(person: Assignment) {
  actionError.value = null
  if (person.user_id !== myId.value) return
  if (person.status === 'swapped' || person.status === 'removed') return
  asking.value = person
}

async function run(action: () => Promise<unknown>) {
  busy.value = true
  actionError.value = null
  try {
    await action()
    asking.value = null
    taking.value = null
    doubleAsk.value = false
    await load()
  } catch (err) {
    if (await me.handleAuthError(err)) return
    const code = (err as { code?: string })?.code
    if (code === 'DOUBLE_SHIFT' && taking.value && !doubleAsk.value) {
      doubleAsk.value = true
      return
    }
    actionError.value = apiErrorText(err)
  } finally {
    busy.value = false
  }
}

function sendRequest(body: { to_user_id?: string, reason: 'zamjena' | 'bolest', note?: string }) {
  const assignment = asking.value
  if (!assignment) return
  void run(() => api.requestSwap({ assignment_id: assignment.id, ...body }))
}

function openTake(offer: SwapRequestView) {
  taking.value = offer
  doubleAsk.value = false
  actionError.value = null
}

const accept = (force = false) => run(() => api.acceptSwap(taking.value!.id, force))
const decline = (row: SwapRequestView) => run(() => api.declineSwap(row.id))
const cancel = (row: SwapRequestView) => run(() => api.cancelSwap(row.id))

/** Everyone but me. An offer to yourself is not an offer, and the server agrees. */
const colleagues = computed(() =>
  team.value
    .filter(u => u.id !== myId.value && u.role !== 'admin')
    .map(u => ({ id: u.id, name: u.name })))
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

          <!-- The cards that need an answer come first: an offer for me, and my
               own live request. Everything below is just the week. -->
          <section v-if="data?.offers.length" class="flex flex-col gap-2">
            <h2 class="text-body font-semibold text-text-2">Traži se zamjena</h2>
            <article
              v-for="offer in data.offers"
              :key="offer.id"
              class="card flex flex-col gap-2 p-3"
            >
              <div class="font-semibold">
                {{ offer.from_user_name }} · {{ dayLabelBs(offer.work_date) }}
              </div>
              <div class="text-label text-text-2">
                {{ offer.template_name }} {{ timeSpanBs(offer.start_time, offer.end_time) }}
                <span v-if="offer.to_user_name"> · tebi</span>
              </div>
              <div class="flex gap-2">
                <button
                  type="button" class="btn btn-primary grow"
                  :disabled="!online || busy"
                  @click="openTake(offer)"
                >
                  Preuzimam
                </button>
                <button
                  v-if="offer.to_user_id"
                  type="button" class="btn btn-ghost"
                  :disabled="!online || busy"
                  @click="decline(offer)"
                >
                  Ne mogu
                </button>
              </div>
            </article>
          </section>

          <section v-if="data?.mine.length" class="flex flex-col gap-2">
            <h2 class="text-body font-semibold text-text-2">Moji zahtjevi</h2>
            <article
              v-for="row in data.mine"
              :key="row.id"
              class="card flex flex-col gap-2 p-3"
            >
              <div class="font-semibold">
                Traži se zamjena · {{ dayLabelBs(row.work_date) }}
              </div>
              <div class="text-label text-text-2">
                {{ row.template_name }} {{ timeSpanBs(row.start_time, row.end_time) }}
                <span v-if="row.to_user_name"> · {{ row.to_user_name }}</span>
              </div>
              <button
                type="button" class="btn btn-ghost self-start"
                :disabled="!online || busy"
                @click="cancel(row)"
              >
                Povuci
              </button>
            </article>
          </section>

          <!-- Which week. A control, not two primary actions. -->
          <UiSeg
            block
            label="Sedmica"
            :options="SEGMENTS"
            :model-value="which"
            @update:model-value="which = $event as typeof which"
          />

          <p v-if="!online" class="chip chip-warn self-start">
            Nema veze — zamjene traže internet
          </p>
          <p v-if="actionError" class="note note-danger" role="alert">
            {{ actionError }}
          </p>

          <p v-if="unpublished" class="empty">
            {{ which === 'sljedeca'
              ? 'Raspored za sljedeću sedmicu još nije objavljen.'
              : 'Raspored za ovu sedmicu još nije objavljen.' }}
          </p>

          <template v-else>
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

              <button
                v-for="person in day.rows"
                :key="person.id"
                type="button"
                class="flex min-h-12 items-center gap-3 rounded-control px-2 text-left"
                :class="person.user_id === myId
                  ? 'bg-accent/15 text-text'
                  : 'text-text-2'"
                :disabled="person.user_id !== myId || !online"
                @click="tap(person)"
              >
                <span
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                  :class="person.user_id === myId
                    ? 'bg-accent text-accent-ink'
                    : 'bg-surface-2 text-text-2'"
                >{{ person.user_initials }}</span>

                <span class="grow truncate">
                  <span :class="{ 'line-through': person.status === 'sick' || person.status === 'absent' }">
                    {{ person.user_name }}
                  </span>
                  <small class="block text-caption tracking-normal text-muted">{{ person.template_name }}</small>
                </span>

                <span v-if="person.user_id === myId" class="num shrink-0 text-label font-semibold">
                  {{ timeSpanBs(person.start_time, person.end_time) }}
                </span>
                <span v-if="person.swap_pending" class="chip chip-warn shrink-0">zamjena</span>
                <span
                  v-else-if="person.status !== 'planned'"
                  class="chip shrink-0"
                >{{ STATUS_BS[person.status] }}</span>
              </button>
            </section>
          </template>
        </template>
      </main>

      <RasporedSwapSheet
        v-if="asking"
        :person="asking"
        :colleagues="colleagues"
        :offline="!online"
        :busy="busy"
        :error="actionError"
        @close="asking = null"
        @send="sendRequest"
      />

      <!-- *Preuzimam*: one confirmation, because taking a shift is a promise to
           be there. `409 DOUBLE_SHIFT` turns the same sheet into the second ask. -->
      <div v-if="taking" class="fixed inset-0 z-50">
        <div class="sheet-scrim" @click="taking = null" />
        <div
          class="sheet-panel absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3"
          role="dialog"
          aria-label="Preuzimanje smjene"
        >
          <span class="mx-auto h-1 w-10 shrink-0 rounded-full bg-line" />
          <h2 class="section-title">
            {{ doubleAsk ? 'Dupla smjena' : 'Preuzimaš smjenu' }}
          </h2>
          <p class="text-label text-text-2">
            {{ dayLabelBs(taking.work_date) }} · {{ taking.template_name }}
            {{ timeSpanBs(taking.start_time, taking.end_time) }}
            <template v-if="doubleAsk">
              — tog dana već imaš jednu smjenu.
            </template>
          </p>
          <p v-if="actionError" class="note note-danger" role="alert">
            {{ actionError }}
          </p>
          <button
            type="button" class="btn btn-primary"
            :disabled="!online || busy"
            @click="accept(doubleAsk)"
          >
            {{ doubleAsk ? 'Svejedno preuzimam' : 'Preuzimam' }}
          </button>
          <button type="button" class="btn btn-ghost" @click="taking = null">Odustani</button>
        </div>
      </div>
    </div>
  </ClientOnly>
</template>
