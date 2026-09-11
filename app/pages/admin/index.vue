<script setup lang="ts">
/**
 * *Puls* — what is happening in the café right now, cut to the four things the
 * owner actually watches from his phone:
 *
 *   1. what the café has taken on the shift that is running;
 *   2. which shift that is — *Dnevna* or *Večernja*, the first or the second;
 *   3. who is working it;
 *   4. the floor, drawn the way the waiter's screen draws it.
 *
 * The six tiles, the *Zahtijeva pažnju* list, the flags and the feed are gone by
 * the owner's own instruction. The one thing that could not simply go with them
 * is `PulsOdluke` — read its comment: two of that list's buttons had no other
 * door in the app, so a single row appears at the foot of the page when, and
 * only when, something is waiting to be decided.
 *
 * **One read.** Everything live comes out of `GET /api/owner/live`. Nothing here
 * opens a second endpoint for a number that is already in that object, and
 * nothing here keeps a `setInterval` — the dashboard has exactly one timer,
 * `useAdminChanges()`, and this page refetches on its tick.
 *
 * **Why it refetches on every tick and not only when something is written.**
 * Half of this screen moves with the clock rather than with the ledger: a table
 * gets older, a shift crosses into the evening. So the server puts the minute
 * into this route's ETag on purpose and the page asks again every 15 s. An
 * **ETag** is a fingerprint of an answer — the browser sends it back, and a
 * server whose answer has not changed replies "304 Not Modified" with no body
 * at all.
 *
 * **Two things that are not in the live read, and neither of them is a poll.**
 * The floor plan's names, zones and coordinates belong to `GET /api/bootstrap`,
 * which every screen in the app already holds and which changes about twice a
 * year; the venue's shift templates belong to `GET /api/admin/shift-templates`,
 * which is the *Šabloni* screen's own list and changes about as often. Both are
 * `useAsyncData`, so each is one download per visit and neither adds a timer.
 * The shift's *name* is read from those templates rather than written here,
 * because a café that adds a third shift must not need this file edited.
 */
import type { AttentionAction, AttentionItem, OwnerLive, TabDetail } from '#shared/types'
import type { PulsFloorCell } from '~/utils/puls'
import { businessDate, localTime } from '#shared/dates'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Puls' })

const api = useAdminApi()

const live = ref<OwnerLive | null>(null)
const loadError = ref('')
/** When the last read actually landed — the "Ažurirano 22:41" in the header. */
const updatedAt = ref<string | null>(null)

/** The floor plan's names, zones and coordinates. Cached by `useAsyncData`. */
const { data: bootstrap } = useBootstrapData()

/** *Dnevna* 08–16 and *Večernja* 16–01, as the roster holds them. */
const { data: templates } = useAsyncData(
  'admin:shift-templates',
  () => api.getShiftTemplates(),
  { server: false, default: () => [] },
)

/**
 * A clock for *rendering*, not for fetching.
 *
 * Table ages are drawn from `opened_at` against "now", so without something
 * ticking, "48 min" would sit there saying 48 min until the next poll. VueUse's
 * `useNow` re-renders them every half minute; the data still arrives only on the
 * one poll.
 */
const now = useNow({ interval: 30_000 })

// One timer for the whole dashboard; this page only subscribes to its tick.
// `load` is a function declaration, so it is hoisted above this line.
const changes = useAdminChanges({ raw: () => { void load() } })

/** One read at a time: the mount and the first tick must not both fetch. */
let inFlight = false

async function load() {
  if (inFlight) return
  inFlight = true
  try {
    live.value = await api.getLive()
    updatedAt.value = new Date().toISOString()
    loadError.value = ''
    changes.setAttentionCount(live.value.attention.length)
  } catch (err) {
    // The old numbers stay on screen and the header says they are old — a
    // dashboard that silently shows yesterday's promet is worse than one that
    // admits it could not reach the server.
    loadError.value = apiErrorText(err)
  } finally {
    inFlight = false
  }
}

// ---------------------------------------------------------------------------
// The shift
// ---------------------------------------------------------------------------

/** Null unless a shift is `open` or `closing`; the screen then says so plainly. */
const shift = computed(() => live.value?.shift ?? null)

/**
 * The people on the shift — and nobody at all once it has closed.
 *
 * `live.who` is folded from the *focus* shift, which is the last one of the day
 * when none is open. Drawing that list under "Ko radi" would say the people who
 * went home an hour ago are working.
 */
const who = computed(() => (shift.value ? live.value?.who ?? [] : []))

const prometFen = computed(() => shiftPrometFen(who.value))

/**
 * Which shift this is, named from the roster's own templates and asked of the
 * café's own wall clock — `localTime` from `shared/dates.ts`, never
 * `getHours()`, which would answer in whatever zone the laptop is set to.
 *
 * `now` ticks every half minute for the table ages, so the name follows the
 * evening over 16:00 without anything else being fetched.
 */
const naming = computed(() => (shift.value
  ? shiftNaming(templates.value ?? [], localTime(now.value.toISOString()))
  : null))

/**
 * "pet 11.09.2026. · Ažurirano 01:16".
 *
 * The night comes from the open shift when there is one and from the clock when
 * there is not — `businessDate()`, so the small hours still read as the evening
 * they belong to rather than rolling over at midnight and leaving the head
 * saying nothing at all on the one screen the owner opens at two.
 */
const headerLine = computed(() => {
  const date = shift.value?.business_date ?? businessDate(now.value.toISOString())
  const parts = [`${weekdayBs(date)} ${dateBs(date)}`]
  if (updatedAt.value) parts.push(`Ažurirano ${timeBs(updatedAt.value)}`)
  return parts.join(' · ')
})

// ---------------------------------------------------------------------------
// The floor
// ---------------------------------------------------------------------------

const zones = computed(() => (live.value && bootstrap.value
  ? floorZones(live.value.tables, bootstrap.value.tables, now.value.getTime())
  : []))

// ---------------------------------------------------------------------------
// The decisions that had nowhere else to go (see `PulsOdluke`)
// ---------------------------------------------------------------------------

/** `"<ref_id>|<action>"` of the decision in flight, so only that button spins. */
const busy = ref<string | null>(null)
const decideError = ref('')

/** The force-close sheet: the one action that will not go without a sentence. */
const noteFor = ref<{ item: AttentionItem, action: AttentionAction, target: string } | null>(null)
const noteText = ref('')
const noteError = ref('')

function onAct(item: AttentionItem, action: AttentionAction, target: string) {
  decideError.value = ''
  if (decisionNeedsNote(item.ref_type, action)) {
    noteFor.value = { item, action, target }
    noteText.value = ''
    noteError.value = ''
    return
  }
  void post(item, action, target)
}

async function post(
  item: AttentionItem, action: AttentionAction, target: string, note?: string,
) {
  if (busy.value) return
  busy.value = `${item.ref_id}|${action}`
  try {
    await api.postAttention(target, decisionBody(item.ref_type, action, note))
    // The row is gone from the server's list the moment the decision commits,
    // so the honest way to take it off the screen is to re-read — not to splice
    // it out of an array and hope the two agree.
    await load()
    noteFor.value = null
  } catch (err) {
    decideError.value = apiErrorText(err)
    noteError.value = decideError.value
  } finally {
    busy.value = null
  }
}

function confirmNote() {
  const pendingAct = noteFor.value
  if (!pendingAct) return
  if (noteText.value.trim().length < NOTE_MIN) {
    noteError.value = `Napiši razlog — najmanje ${NOTE_MIN} znaka.`
    return
  }
  void post(pendingAct.item, pendingAct.action, pendingAct.target, noteText.value)
}

// ---------------------------------------------------------------------------
// A table's rounds
// ---------------------------------------------------------------------------

const tab = ref<TabDetail | null>(null)
const tabTitle = ref('')
const tabPending = ref(false)
const tabError = ref('')
const tabOpen = ref(false)

async function openTable(cell: PulsFloorCell) {
  if (!cell.tab_id) return
  tabOpen.value = true
  tabTitle.value = cell.name
  tab.value = null
  tabError.value = ''
  tabPending.value = true
  try {
    tab.value = await api.getTab(cell.tab_id)
  } catch (err) {
    tabError.value = apiErrorText(err)
  } finally {
    tabPending.value = false
  }
}

onMounted(() => { void load() })
</script>

<template>
  <div class="a-page">
    <UiPageHead
      eyebrow="Lokal"
      title="Puls"
      :sub="headerLine || 'Šta se upravo dešava u lokalu'"
      :stale="loadError ? `Nije osvježeno — ${loadError}` : undefined"
    />

    <template v-if="live">
      <PulsShift :shift="shift" :promet-fen="prometFen" :naming="naming" />

      <PulsWhoStrip v-if="shift" :who="who" />

      <PulsFloor :zones="zones" :loading="!bootstrap" @open="openTable" />

      <PulsOdluke
        v-if="live.attention.length"
        :items="live.attention"
        :shift-id="shift?.id"
        :busy="busy"
        :error="decideError"
        @act="onAct"
      />
    </template>

    <!-- The first paint: a skeleton, never a spinner over numbers that are not
         there yet. -->
    <UiCard v-else-if="!loadError">
      <p class="a-muted">Učitavanje…</p>
    </UiCard>

    <!-- The force-close note. `POST /api/shifts/:id/force-close` refuses an
         empty one, and a decision this heavy should carry a sentence anyway. -->
    <UiSheet
      :open="!!noteFor"
      title="Zatvori smjenu bez predaje"
      action="Zatvori smjenu"
      :pending="!!busy"
      @close="noteFor = null"
      @confirm="confirmNote"
    >
      <p class="a-muted">{{ noteFor?.item.title_bs }}</p>
      <UiField
        v-model="noteText"
        label="Razlog"
        kind="textarea"
        :error="noteError"
        placeholder="Otišao kući prije predaje…"
      />
    </UiSheet>

    <!-- One table's rounds. Read-only: the owner looks, the waiter charges. -->
    <UiSheet :open="tabOpen" :title="tabTitle" @close="tabOpen = false">
      <p v-if="tabPending" class="a-muted">Učitavanje…</p>
      <p v-else-if="tabError" class="a-error">{{ tabError }}</p>

      <template v-else-if="tab">
        <div class="a-tab-sum">
          <span>{{ tab.tab.assigned_to_name ?? '' }}</span>
          <span class="a-muted">otvoren {{ timeBs(tab.tab.opened_at) }}</span>
          <UiMoney class="a-tab-total" :fen="tab.money.remaining_fen" />
        </div>

        <div v-for="order in tab.orders" :key="order.id" class="a-tab-order">
          <div class="a-tab-order-head">
            <b>{{ order.shift_seq ? `${order.shift_seq}. tura` : 'tura' }}</b>
            <span class="a-muted">{{ timeBs(order.at) }} · {{ order.locked_by_name }}</span>
          </div>
          <div v-for="line in order.lines" :key="line.id" class="a-tab-line">
            <span>
              {{ line.qty > 1 ? `${line.qty}× ` : '' }}{{ line.name_snapshot }}
              <em v-if="line.flavour_names.length">({{ line.flavour_names.join(' + ') }})</em>
              <em v-if="line.status !== 'ok'" class="a-tab-mark">· {{ line.status === 'gratis' ? 'gratis' : 'storno' }}</em>
            </span>
            <UiMoney :fen="line.charged_fen" :currency="false" :colour="false" />
          </div>
        </div>

        <div v-for="payment in tab.payments" :key="payment.id" class="a-tab-line">
          <span>{{ payment.method === 'cash' ? 'Gotovina' : 'Kartica' }} · {{ timeBs(payment.at) }}</span>
          <UiMoney :fen="payment.amount_fen" :currency="false" :colour="false" />
        </div>
      </template>

      <template #footer>
        <UiButton variant="ghost" @click="tabOpen = false">Zatvori</UiButton>
      </template>
    </UiSheet>
  </div>
</template>

<style scoped>
/**
 * One column, at every width.
 *
 * The page used to be a 7 / 5 split with the lists on the left and the plan on
 * the right, which was the right shape for six tiles and two lists. Four things
 * read top to bottom on a phone — which is what this screen is on ninety-nine
 * nights in a hundred — and on a laptop the same column simply has more air
 * around it, rather than a second column of things the owner did not ask for.
 */
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

.a-muted { margin: 0; color: var(--ink-2); font-size: var(--text-label); }
.a-error { margin: 0; color: var(--danger); font-size: var(--text-label); }

/* -- the tab sheet ------------------------------------------------------- */

.a-tab-sum {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
  font-size: var(--text-label);
}

.a-tab-total {
  margin-left: auto;
  font-family: var(--font-display);
  font-size: var(--text-section);
  font-weight: 700;
}

.a-tab-order { display: flex; flex-direction: column; gap: 4px; }

.a-tab-order-head {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: var(--text-micro);
}

.a-tab-order-head b { font-size: var(--text-label); }

.a-tab-line {
  display: flex;
  gap: 10px;
  align-items: baseline;
  font-size: var(--text-label);
  font-variant-numeric: tabular-nums;
}

.a-tab-line > span:first-child { flex-grow: 1; min-width: 0; }
.a-tab-line em { font-style: normal; color: var(--muted); }
.a-tab-mark { color: var(--danger); }

@media (min-width: 1024px) {
  /* At a desk the four things keep a readable measure instead of stretching to
     a 1400 px table row. */
  .a-page { max-width: 760px; }
}
</style>
