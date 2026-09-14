<script setup lang="ts">
/**
 * One table, read from the floor plan — without leaving it.
 *
 * Tapping an occupied table used to push `/konobar/sto/<id>`, a page of its own
 * with a header, a back arrow and a route. The owner's words: *"lets not lead
 * waiter to its own page. Lets keep him always on the main screen."* He is
 * right, and the reason is not tidiness: a waiter crossing a room looks at four
 * tables in a row, and four page loads with four back-taps between them is a
 * worse machine than one sheet he drops and opens again.
 *
 * **What this sheet is for.** What is owed, what was ordered, and the two
 * things he does next — another round, or the money. That is the whole of an
 * ordinary evening, and all of it now happens over the plan.
 *
 * **What it deliberately is not.** Moving a tab to another table, handing it to
 * a colleague, cancelling a locked line, topping a bowl up with coal, showing
 * the guest his own bill: each of those is a decision with a PIN, a reason or a
 * countdown attached, and each already has a screen that gives it room. They
 * stay one tap further in, behind *Detalji stola*, rather than being folded
 * into a sheet somebody is reading over a tray. The sheet is the evening; the
 * page is the exception.
 *
 * Rounds are **collapsed to their headers** and open on a tap, the same as on
 * the page: a table with six rounds on it is a list of six amounts, not a wall
 * of every drink the guests have had.
 */
import { formatKm } from '#shared/money'
import type { TabDetail, TabLine, TabOrder } from '#shared/types'

const props = withDefaults(defineProps<{
  tableName: string
  /** What is still owed — the phone's own figure, anything queued included. */
  remainingFen: number
  /** What the guests were charged in total, for the line under it. */
  totalFen: number
  detail: TabDetail | null
  loading?: boolean
  error?: string | null
  /** *naplata čeka*, *kasno*, *čeka slanje* — the table's own marks. */
  pendingReview?: boolean
  lateSync?: boolean
  queuedFen?: number
  payQueued?: boolean
  /** Lines tapped on this phone and not yet locked. */
  draftCount?: number
  draftFen?: number
  /** Settled and still occupied — the only thing left to do is clear it. */
  paid?: boolean
  clearing?: boolean
  /** There is a tab here at all: the three secondary actions need one. */
  hasTab?: boolean
}>(), {
  loading: false,
  error: null,
  pendingReview: false,
  lateSync: false,
  queuedFen: 0,
  payQueued: false,
  draftCount: 0,
  draftFen: 0,
  paid: false,
  clearing: false,
  hasTab: false,
})

const emit = defineEmits<{
  close: []
  add: []
  /**
   * Take the money. `andClear` is the difference the owner asked for: the
   * common case is that the guests pay and go, so *Naplati i očisti* is the
   * primary button; *Naplati* takes the money and leaves them sitting there
   * with a checkmark on their table until somebody clears it.
   */
  pay: [andClear: boolean]
  /** *Očisti sto* — give the table back, with no money involved. */
  clear: []
  /** *Premjesti sto · Predaj kolegi* — the one that stayed of the three. */
  move: []
  /**
   * A locked line was tapped — the way to a storno. It came over from the table
   * page with the rest: a waiter who rings up the wrong drink has to be able to
   * cancel it from wherever he is looking at the table, and after *Detalji
   * stola* went that was here or nowhere.
   */
  line: [line: TabLine, round: TabOrder]
}>()

useSheetDismiss(() => emit('close'))

/** Which rounds are open. Closed by default, and reset every time it reopens. */
const openRounds = ref<Set<string>>(new Set())

function toggleRound(id: string) {
  const next = new Set(openRounds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  openRounds.value = next
}

function clock(iso: string): string {
  const at = new Date(iso)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

function roundFen(lines: TabLine[]): number {
  return lines.reduce((sum, line) => sum + line.charged_fen, 0)
}

const rounds = computed(() => props.detail?.orders ?? [])
</script>

<template>
  <div class="fixed inset-0 z-50">
    <div class="sheet-scrim" @click="emit('close')" />

    <div
      class="sheet-panel absolute inset-x-0 bottom-0 mx-auto flex max-h-[94dvh] min-h-[62dvh] w-full max-w-3xl flex-col gap-4 overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3"
      role="dialog"
      :aria-label="tableName"
    >
      <span class="mx-auto h-1 w-10 shrink-0 rounded-full bg-line" />

      <!--
        The corners: the way out on the left, the thing he came to do on the
        right.

        *+ Dodaj* was a button beside the copper one, which made the row read as
        a choice between adding and paying — two things that are not
        alternatives. Up here it is out of the way of the decision and still the
        easiest target on the sheet. The × is the twin of tapping the scrim,
        which still closes it: a thumb holding a tray does not always find the
        strip of screen above a sheet.
      -->
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="flex size-11 shrink-0 items-center justify-center rounded-control bg-surface-2 text-text-2"
          aria-label="Zatvori"
          @click="emit('close')"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <span class="section-title grow truncate">{{ tableName }}</span>

        <button type="button" class="btn btn-secondary shrink-0 px-4" @click="emit('add')">
          + Dodaj
        </button>
      </div>

      <!-- What is owed. The one number the sheet exists to show, at the size
           the table page showed it — a waiter reads it across a room. -->
      <div class="flex flex-col gap-1">
        <div class="flex items-baseline gap-3">
          <span class="eyebrow grow">Za naplatu</span>
        </div>
        <p class="metric num">{{ formatKm(remainingFen) }}</p>
        <p v-if="remainingFen !== totalFen" class="num text-label text-text-2">
          od {{ formatKm(totalFen) }} ukupno
        </p>

        <div
          v-if="payQueued || queuedFen > 0 || pendingReview || lateSync"
          class="flex flex-wrap items-center gap-2 pt-1"
        >
          <span v-if="payQueued" class="chip chip-warn">naplata čeka slanje</span>
          <span v-else-if="queuedFen > 0" class="chip chip-warn">čeka slanje</span>
          <span v-else-if="pendingReview" class="chip chip-warn">naplata čeka</span>
          <span v-if="lateSync" class="chip chip-warn">kasno</span>
        </div>
      </div>

      <p v-if="error" class="note note-warn" role="alert">{{ error }}</p>

      <!-- The draft this phone is still holding, if any: it is money nobody has
           been charged yet, so it never joins the locked rounds below. -->
      <div v-if="draftCount > 0" class="card border-dashed border-accent-line p-3">
        <div class="flex items-center gap-2">
          <span class="chip chip-accent">Nije poslano</span>
          <span class="num grow text-right text-body font-semibold">{{ formatKm(draftFen) }}</span>
        </div>
      </div>

      <p v-if="loading && !rounds.length" class="py-6 text-center text-text-2">
        Učitavanje…
      </p>

      <ul v-else-if="rounds.length" class="flex flex-col gap-2">
        <li v-for="(round, index) in rounds" :key="round.id" class="card-2 overflow-hidden">
          <button
            type="button"
            class="flex min-h-14 w-full items-center gap-2.5 px-3 py-2.5 text-left"
            :aria-expanded="openRounds.has(round.id)"
            @click="toggleRound(round.id)"
          >
            <span class="grow truncate text-label font-semibold text-text-2">
              {{ index + 1 }}. tura · {{ clock(round.at) }} · {{ round.locked_by_name }}
            </span>
            <span class="num shrink-0 text-body font-semibold">
              {{ formatKm(roundFen(round.lines)) }}
            </span>
            <svg
              width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
              class="shrink-0 text-muted transition-transform"
              :class="openRounds.has(round.id) ? 'rotate-180' : ''"
              aria-hidden="true"
            ><path d="M6 9l6 6 6-6" /></svg>
          </button>

          <ul v-if="openRounds.has(round.id)" class="flex flex-col border-t border-line-soft px-3">
            <li v-for="line in round.lines" :key="line.id" class="border-b border-line-soft last:border-b-0">
              <!-- Tappable: a locked line is where a storno starts. -->
              <button
                type="button"
                class="flex w-full items-baseline gap-2 py-2.5 text-left"
                @click="emit('line', line, round)"
              >
                <span class="min-w-0 grow text-body" :class="line.status === 'storno' ? 'text-muted line-through' : ''">
                  <span class="num font-semibold">{{ line.qty }}×</span>
                  {{ line.name_snapshot }}
                  <small v-if="line.flavour_names.length" class="text-text-2">
                    · {{ line.flavour_names.join(' + ') }}
                  </small>
                  <small v-if="line.note" class="text-warn">· {{ line.note }}</small>
                </span>
                <span class="num shrink-0 text-label">{{ formatKm(line.charged_fen) }}</span>
              </button>
            </li>
          </ul>
        </li>
      </ul>

      <p v-else class="py-6 text-center text-text-2">
        Još nijedna tura nije poslana.
      </p>

      <!--
        The buttons: how the table ends, and then everything else.

        *+ Dodaj* is gone from here — it is in the header, out of the way of a
        decision it was never an alternative to. What is left below the rounds
        is the two ways a table finishes and, quieter under them, the three
        things that used to need a page of their own.

        **Nothing leads anywhere any more.** *Detalji stola* pushed
        `/konobar/sto/<id>` for three actions that were all sheets when you got
        there; they open from here instead, over the plan, which is the whole
        point of the sheet existing.
      -->
      <div class="flex flex-col gap-2 border-t border-line pt-3">
        <button
          v-if="paid"
          type="button"
          class="btn btn-primary btn-lg"
          :disabled="clearing"
          @click="emit('clear')"
        >
          {{ clearing ? 'Čistim…' : 'Očisti sto' }}
        </button>

        <template v-else>
          <button
            type="button"
            class="btn btn-primary btn-lg"
            :disabled="remainingFen <= 0"
            @click="emit('pay', true)"
          >
            Naplati i očisti
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-lg"
            :disabled="remainingFen <= 0"
            @click="emit('pay', false)"
          >
            Samo naplati — gosti ostaju
          </button>
        </template>

        <!--
          The rest of what a table can need, one step quieter.

          *Pokaži gostu* and *Nije plaćeno* left at the owner's word; the row
          they were in is where *Policija* and *Rashod* are going, once the
          shift's deduction categories exist to put them in.
        -->
        <div class="flex pt-1">
          <button
            type="button"
            class="btn btn-secondary px-4 text-label"
            :disabled="!hasTab"
            @click="emit('move')"
          >
            Premjesti
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
