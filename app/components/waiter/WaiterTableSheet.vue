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
import type { TabDetail, TabLine } from '#shared/types'

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
  details: []
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
      class="sheet-panel absolute inset-x-0 bottom-0 mx-auto flex max-h-[88dvh] w-full max-w-3xl flex-col gap-4 overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3"
      role="dialog"
      :aria-label="tableName"
    >
      <span class="mx-auto h-1 w-10 shrink-0 rounded-full bg-line" />

      <!-- What is owed. The one number the sheet exists to show, at the size
           the table page showed it — a waiter reads it across a room. -->
      <div class="flex flex-col gap-1">
        <div class="flex items-baseline gap-3">
          <span class="eyebrow grow">{{ tableName }} · za naplatu</span>
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
            <li
              v-for="line in round.lines"
              :key="line.id"
              class="flex items-baseline gap-2 border-b border-line-soft py-2.5 last:border-b-0"
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
            </li>
          </ul>
        </li>
      </ul>

      <p v-else class="py-6 text-center text-text-2">
        Još nijedna tura nije poslana.
      </p>

      <!--
        What happens next, and it is two different things.

        Taking the money and giving the table back used to be one act. In a
        shisha lounge they are not: a bowl is an hour and a half and the bill is
        often settled long before anybody stands up. So *Naplati i očisti* is the
        common case and carries the number the guest is about to hand over, and
        *Naplati* below it takes the money and leaves them sitting — the tile
        keeps its shift's colour and gains a checkmark until somebody clears it.

        A table that is already settled has only one move left, so that is all
        it is offered. *+ Dodaj* stays either way: guests who have paid often
        order again, and that round opens a fresh tab in whichever shift is
        running — which is what turns the tile from orange to blue.
      -->
      <div class="flex flex-col gap-2">
        <div class="flex gap-2">
          <button type="button" class="btn btn-secondary btn-lg shrink-0 px-4" @click="emit('add')">
            + Dodaj
          </button>

          <button
            v-if="paid"
            type="button"
            class="btn btn-primary btn-lg grow"
            :disabled="clearing"
            @click="emit('clear')"
          >
            {{ clearing ? 'Čistim…' : 'Očisti sto' }}
          </button>
          <button
            v-else
            type="button"
            class="btn btn-primary btn-lg grow"
            :disabled="remainingFen <= 0"
            @click="emit('pay', true)"
          >
            Naplati i očisti ·<span class="num">{{ formatKm(remainingFen) }}</span>
          </button>
        </div>

        <button
          v-if="!paid"
          type="button"
          class="btn btn-secondary btn-lg"
          :disabled="remainingFen <= 0"
          @click="emit('pay', false)"
        >
          Naplati — gosti ostaju
        </button>

        <!-- Everything that is not an ordinary evening. -->
        <button type="button" class="btn btn-ghost" @click="emit('details')">
          Detalji stola
        </button>
      </div>
    </div>
  </div>
</template>
