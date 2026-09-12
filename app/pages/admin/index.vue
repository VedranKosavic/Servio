<script setup lang="ts">
/**
 * *Puls* — what is happening in the café right now, cut to what the owner
 * actually watches from his phone:
 *
 *   1. a line that says hello, and whose screen this is;
 *   2. **two shift cards**, always: the shift with the money on it and the shift
 *      that comes next;
 *   3. who is working the shift that is running;
 *   4. the floor, drawn the way the waiter's screen draws it.
 *
 * The six tiles, the *Zahtijeva pažnju* list, the flags, the feed and — as of
 * tonight — the *Čeka odluku* row are all gone by the owner's own instruction.
 * What that last one cost is written down in the report and in the comment above
 * `decisionBody()`: two decide routes now have no door on any screen.
 *
 * **Two cards and never an empty state.** *"Nema otvorene smjene"* was the honest
 * answer to "what is the promet" and the wrong thing to put on a screen at four in
 * the morning, because the owner is not asking about a shift that does not exist —
 * he is asking what last night took and when the next one starts. So the page
 * always draws two cards, and which two is `shiftClock()`'s answer:
 *
 *   a shift is running   → that shift with its takings, live · the next shift
 *   nothing is running   → the last shift with its takings · the next shift
 *   nothing is running,
 *   but a shift should be → the last shift with its takings · this shift, saying
 *                           it has not been opened
 *
 * **One read, and a second only when the night needs it.** Everything live comes
 * out of `GET /api/owner/live`. That read carries the *open* shift and is `null`
 * once the night is closed — it has no id for the shift that just finished — so
 * when there is nothing open the page also asks `GET /api/owner/shifts` for the
 * last two business days, which is where the last shift's id and its promet come
 * from. On an ordinary evening that call is never made.
 *
 * **One timer.** The dashboard has exactly one, `useAdminChanges()`, and this page
 * refetches on its tick. Nothing here keeps a `setInterval` of its own.
 *
 * **Why it refetches on every tick and not only when something is written.** Half
 * of this screen moves with the clock rather than with the ledger: a shift crosses
 * into the evening, a night ends. So the server puts the minute into this route's
 * ETag on purpose and the page asks again every 15 s. An **ETag** is a fingerprint
 * of an answer — the browser sends it back, and a server whose answer has not
 * changed replies "304 Not Modified" with no body at all.
 *
 * **Two things that are not in the live read, and neither of them is a poll.** The
 * floor plan's names, zones and coordinates belong to `GET /api/bootstrap`, which
 * every screen in the app already holds and which changes about twice a year; the
 * venue's shift templates belong to `GET /api/admin/shift-templates`. Both are
 * `useAsyncData`, so each is one download per visit and neither adds a timer. The
 * shifts' *names and hours* are read from those templates rather than written
 * here, because a café that adds a third shift must not need this file edited.
 */
import type { OwnerLive, OwnerShiftRow, TabDetail } from '#shared/types'
import type { PulsFloorCell } from '~/utils/puls'
import { addDays, businessDate, localTime } from '#shared/dates'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Puls' })

const api = useAdminApi()
const { user } = useMe()

const live = ref<OwnerLive | null>(null)
const loadError = ref('')
/** When the last read actually landed — the "Ažurirano 22:41" in the header. */
const updatedAt = ref<string | null>(null)

/** The floor plan's names, zones and coordinates. Cached by `useAsyncData`. */
const { data: bootstrap } = useBootstrapData()

/** *Prva smjena* 07–15 and *Druga* 15–23, as the roster holds them. */
const { data: templates } = useAsyncData(
  'admin:shift-templates',
  () => api.getShiftTemplates(),
  { server: false, default: () => [] },
)

/**
 * A clock for *rendering*, not for fetching.
 *
 * The cards move with the wall clock as much as with the ledger — a shift ends at
 * 23:00 whether or not anybody writes a row — so without something ticking, "za
 * 20 min" would sit there saying 20 min until the next poll. VueUse's `useNow`
 * re-renders them every half minute; the data still arrives only on the one poll.
 */
const now = useNow({ interval: 30_000 })

/**
 * The café's own wall clock, as `HH:MM`.
 *
 * `localTime` from `shared/dates.ts` and never `getHours()`, which answers in
 * whatever zone the laptop is set to — a dashboard read on a phone still on UK
 * time would name the wrong shift for an hour of every evening.
 */
const wallClock = computed(() => localTime(now.value.toISOString()))

/** Where the café is in its day: current, last and next, from the templates. */
const clock = computed(() => shiftClock(templates.value ?? [], wallClock.value))

// One timer for the whole dashboard; this page only subscribes to its tick.
// `load` is a function declaration, so it is hoisted above this line.
const changes = useAdminChanges({ raw: () => { void load() } })

/** One read at a time: the mount and the first tick must not both fetch. */
let inFlight = false

async function load() {
  if (inFlight) return
  inFlight = true
  try {
    const fresh = await api.getLive()

    // The one extra read, and only on the night it is needed: with no shift open
    // the live answer has no id and no promet for the shift that just finished.
    // It happens **before** the screen is handed the new answer, or the first
    // paint of a quiet morning would flash "Nije bilo smjene" for as long as the
    // second read takes.
    if (fresh.shift) lastShift.value = null
    else await loadLastShift()

    live.value = fresh
    updatedAt.value = new Date().toISOString()
    loadError.value = ''
    changes.setAttentionCount(fresh.attention.length)
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
// The shift that is running
// ---------------------------------------------------------------------------

/** Null unless a shift is `open` or `closing`; the cards then show the last one. */
const shift = computed(() => live.value?.shift ?? null)

/**
 * The people on the shift — and nobody at all once it has closed.
 *
 * `live.who` is folded from the *focus* shift, which is the last one of the day
 * when none is open. Drawing that list under "Ko radi" would say the people who
 * went home an hour ago are working.
 */
const who = computed(() => (shift.value ? live.value?.who ?? [] : []))

/**
 * *Ko radi*, which is now the **plan** with tonight's fact folded into it.
 *
 * The card used to be `who` alone and was therefore empty every morning before
 * somebody PIN-ed in — on the one screen whose job is to say what the café is
 * doing today. `live.rostered` is today's *Raspored*, straight from the same
 * read, and `whoShifts()` lays the two against each other.
 */
const rostered = computed(() => live.value?.rostered ?? [])

/**
 * Which shift *Ko radi* marks **u toku**, and where somebody working without
 * being on the plan is drawn.
 *
 * The clock's own window when the clock is inside one. Otherwise a window only
 * if a shift is genuinely open — the bar that is still serving at half eleven is
 * working the evening that has just ended, and at three in the morning with
 * everything shut nothing is running at all, however recently it was. Without
 * that second condition the card would print *u toku* over an empty room.
 *
 * The last branch is the café that has an open shift and no templates: the
 * people on it still have to be drawn somewhere.
 */
const whoWindow = computed(() => {
  const window = clock.value.current ?? (shift.value ? clock.value.last?.window ?? null : null)
  if (window) return { id: window.id, name: window.name, hours: window.hours }
  return shift.value ? { id: 'open', name: 'Smjena', hours: '' } : null
})

const whoCards = computed(() => whoShifts(rostered.value, who.value, whoWindow.value))

/**
 * What the running shift has taken.
 *
 * Not a number this screen invents: `summarizeShift` refuses to write a summary
 * unless `Σ by_user.promet_fen === promet_fen`, and `live.who` **is** that
 * `by_user` fold for the shift *Puls* is looking at. It is the shift's promet and
 * not the business day's — `promet_danas_fen` sums every shift on the date, which
 * on a day the first shift worked is not what the owner is watching.
 */
const prometFen = computed(() => shiftPrometFen(who.value))

// ---------------------------------------------------------------------------
// The shift that just finished
// ---------------------------------------------------------------------------

/**
 * The newest shift of the last two business days, read only while none is open.
 *
 * Two days and not one, because at half five in the morning the business date is
 * still last night's, and at seven it has rolled over to a day the café has not
 * opened yet — and "the last shift" has to mean the same thing on both sides of
 * that line. `GET /api/owner/shifts` folds a promet for a night that was never
 * closed exactly the way *Smjena* and *Smjene* fold it, so all three screens
 * print one number for one night.
 */
const lastShift = ref<OwnerShiftRow | null>(null)

/**
 * Set when that second read did not land.
 *
 * It is kept apart from the page's own `loadError` so a failure here cannot cost
 * the screen the numbers that *did* arrive — *Puls* is the live read, and this is
 * one card on it. The card then says it could not read the shift rather than
 * saying there was none.
 */
const lastShiftError = ref(false)

async function loadLastShift() {
  try {
    const today = businessDate(now.value.toISOString())
    const rows = await api.getShifts({ from: addDays(today, -1), to: today })
    lastShift.value = [...rows]
      .sort((a, b) => (a.opened_at < b.opened_at ? 1 : -1))[0] ?? null
    lastShiftError.value = false
  } catch {
    lastShiftError.value = true
  }
}

/**
 * Which template the shift on the card belongs to.
 *
 * A shift that has been worked is named by **when it was opened**, not by the
 * clock now: the bar that opened at 15:04 and closed at 23:20 worked *Druga
 * smjena*, and at half eleven the clock owns no window at all.
 */
const lastWindow = computed(() => (lastShift.value
  ? shiftWindowFor(templates.value ?? [], localTime(lastShift.value.opened_at))
  : clock.value.last?.window ?? null))

/**
 * And the running one. The template that owns the clock, or — when the bar has
 * run past closing and no window does — the one that has just ended, which is
 * the shift the people on the floor are still working.
 */
const runningWindow = computed(() => clock.value.current ?? clock.value.last?.window ?? null)

// ---------------------------------------------------------------------------
// The two cards
// ---------------------------------------------------------------------------

/**
 * What one `PulsSmjenaCard` needs. Declared here because this page is the only
 * thing that builds one, and it mirrors that component's props.
 */
interface CardView {
  eyebrow: string
  title: string
  hours: string
  note?: string
  pill?: string
  pillTone?: 'accent' | 'warn' | 'neutral' | 'good'
  fen?: number | null
  empty?: string
  to?: string
  action?: string
}

/** Where a shift's own counter of what it sold lives. */
function soldPath(shiftId: string): string {
  return `/admin/smjena-prodano?id=${shiftId}`
}

/** "pet 11.09.2026.", and nothing at all when it is the night we are standing in. */
function nightLine(date: string): string {
  return date === businessDate(now.value.toISOString())
    ? ''
    : `${weekdayBs(date)} ${dateBs(date)}`
}

/** The card with the money on it: the shift that is running, or the last one. */
const cardMoney = computed<CardView>(() => {
  const running = shift.value

  if (running) {
    return {
      eyebrow: 'U toku',
      title: runningWindow.value?.name ?? 'Smjena',
      hours: runningWindow.value?.hours ?? '',
      pill: shiftPillBs(running.status),
      pillTone: running.closing ? 'warn' : 'accent',
      fen: prometFen.value,
      // The head already says which night this is, so the card only says it when
      // it is *not* the night the clock is in — a shift still open at two in the
      // morning belongs to the evening before, and that is worth a line.
      note: running.closing && running.closer_name
        ? `zatvara ${running.closer_name}`
        : nightLine(running.business_date),
      to: soldPath(running.id),
      action: 'Prodano po artiklu',
    }
  }

  const last = lastShift.value
  if (last) {
    return {
      eyebrow: 'Zadnja smjena',
      title: lastWindow.value?.name ?? 'Smjena',
      hours: lastWindow.value?.hours ?? '',
      pill: shiftPillBs(last.status),
      pillTone: 'neutral',
      fen: last.promet_fen,
      note: [
        `${weekdayBs(last.business_date)} ${dateBs(last.business_date)}`,
        last.closed_at ? `do ${timeBs(last.closed_at)}` : '',
      ].filter(Boolean).join(' · '),
      to: soldPath(last.id),
      action: 'Prodano po artiklu',
    }
  }

  // No shift open and none on either business day: the café has not sold
  // anything yet. A 0,00 KM here would read as a night that took nothing.
  return {
    eyebrow: 'Zadnja smjena',
    title: clock.value.last?.window.name ?? 'Smjena',
    hours: clock.value.last?.window.hours ?? '',
    fen: null,
    empty: lastShiftError.value ? 'Nije učitano' : 'Nije bilo smjene',
    note: lastShiftError.value
      ? 'Zadnja smjena se nije učitala.'
      : templates.value?.length ? 'Nijedna smjena još nije otvorena.' : '',
  }
})

/**
 * Has the shift the clock is inside already been worked and closed?
 *
 * A café that opened at seven and closed at two in the afternoon has *had* its
 * first shift, and telling the owner at half two that it "has not been opened"
 * would be wrong. The same window on the same business day is the test.
 */
const currentWorked = computed(() => Boolean(
  lastShift.value
  && clock.value.current
  && lastWindow.value?.id === clock.value.current.id
  && lastShift.value.business_date === businessDate(now.value.toISOString()),
))

/**
 * The second card.
 *
 * Usually the shift that starts next. The exception is the hour nobody has opened
 * a shift that the roster says should be running — 10:00 with the bar shut, say —
 * where the honest second card is **that** shift, saying it has not been opened,
 * rather than tomorrow morning's.
 */
const cardNext = computed<CardView>(() => {
  const current = clock.value.current

  if (!shift.value && current && !currentWorked.value) {
    return {
      eyebrow: 'Trenutna smjena',
      title: current.name,
      hours: current.hours,
      pill: 'nije otvorena',
      pillTone: 'warn',
      fen: null,
      note: `trebala je početi u ${current.start_time}`,
    }
  }

  const next = clock.value.next
  if (!next) {
    return {
      eyebrow: 'Sljedeća smjena',
      title: 'Nema šablona',
      hours: '',
      fen: null,
      note: 'Smjene se postavljaju u Rasporedu.',
    }
  }

  return {
    eyebrow: 'Sljedeća smjena',
    title: next.window.name,
    hours: next.window.hours,
    fen: null,
    note: shiftWhenBs(next, 'next'),
  }
})

// ---------------------------------------------------------------------------
// The head
// ---------------------------------------------------------------------------

/** *Dobro veče, Harun* — one line, in the eyebrow's row, costing no height. */
const greeting = computed(() => greetingBs(wallClock.value, user.value?.name ?? null))

/**
 * "pet 11.09.2026. · Ažurirano 01:16".
 *
 * The night comes from the open shift when there is one and from the clock when
 * there is not — `businessDate()`, so the small hours still read as the evening
 * they belong to rather than rolling over at midnight and leaving the head saying
 * nothing at all on the one screen the owner opens at two.
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
// A table's rounds
// ---------------------------------------------------------------------------

const tab = ref<TabDetail | null>(null)
/** The tile that was tapped — the age and the *naplata čeka* mark come off it. */
const tabCell = ref<PulsFloorCell | null>(null)
const tabPending = ref(false)
const tabError = ref('')
const tabOpen = ref(false)

async function openTable(cell: PulsFloorCell) {
  if (!cell.tab_id) return
  tabOpen.value = true
  tabCell.value = cell
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
      :eyebrow="greeting"
      title="Puls"
      :sub="headerLine || 'Šta se upravo dešava u lokalu'"
      :stale="loadError ? `Nije osvježeno — ${loadError}` : undefined"
    />

    <template v-if="live">
      <!-- Always two, never an empty state. -->
      <div class="a-smjene">
        <PulsSmjenaCard v-bind="cardMoney" />
        <PulsSmjenaCard v-bind="cardNext" />
      </div>

      <PulsWhoStrip :shifts="whoCards" />

      <PulsFloor :zones="zones" :loading="!bootstrap" @open="openTable" />
    </template>

    <!-- The first paint: a skeleton, never a spinner over numbers that are not
         there yet. -->
    <UiCard v-else-if="!loadError">
      <p class="a-muted">Učitavanje…</p>
    </UiCard>

    <!-- One table's rounds. Read-only: the owner looks, the waiter charges. -->
    <UiSheet :open="tabOpen" :title="tabCell?.name ?? ''" @close="tabOpen = false">
      <p v-if="tabPending" class="a-muted">Učitavanje…</p>
      <p v-else-if="tabError" class="a-error">{{ tabError }}</p>

      <template v-else-if="tab">
        <div class="a-tab-sum">
          <span>{{ tab.tab.assigned_to_name ?? '' }}</span>
          <!-- The age the tile no longer prints: the plan has one colour for
               every occupied table, so how long they have been sitting is read
               here instead. -->
          <span class="a-muted num">
            otvoren {{ timeBs(tab.tab.opened_at) }}{{ tabCell?.age ? ` · ${tabCell.age}` : '' }}
          </span>
          <UiMoney class="a-tab-total" :fen="tab.money.remaining_fen" />
        </div>

        <UiPill v-if="tabCell?.pending_review" tone="warn">naplata čeka</UiPill>

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
 * the right, which was the right shape for six tiles and two lists. Three things
 * read top to bottom on a phone — which is what this screen is on ninety-nine
 * nights in a hundred — and on a laptop the same column simply has more air
 * around it, rather than a second column of things the owner did not ask for.
 */
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

/**
 * The two shift cards: stacked on a phone, side by side from 560 px.
 *
 * Stacked is not a compromise. The takings are the one number this screen is
 * about and they are set at `--text-display`; two of those columns at 375 px
 * would put a four-figure amount on two lines, and a hero number that wraps is
 * not a hero number.
 */
.a-smjene { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }

@media (min-width: 560px) {
  .a-smjene { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

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
  /* At a desk the three things keep a readable measure instead of stretching to
     a 1400 px table row. */
  .a-page { max-width: 760px; }
}

/**
 * The layout's *Razgovor* button floats over the bottom-right corner of every
 * dashboard screen, and the floor plan is the last thing on this page — so the
 * page ends with enough room under it for the plan to scroll clear of the button
 * instead of finishing underneath it.
 */
@media (max-width: 1023px) {
  .a-page { padding-bottom: 72px; }
}
</style>
