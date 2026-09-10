<script setup lang="ts">
/**
 * One waiting request in the bartender's *Na čekanju* queue (S14).
 *
 * Everything a person needs to answer it is on the card, because a bartender
 * with a tray in one hand is not going to open anything: **who** asked, **which
 * table**, **which line**, **how much**, **why**, and what it does to the shelf.
 *
 * The two buttons are only drawn while `can_decide` is true — the server's own
 * answer to "would this person, in this role, in this window, get past
 * `requireDecider` right now". Past `bartender_approve_window_s` the card says
 * *Ide vlasniku* instead, which is the truth rather than a button that 403s.
 *
 * `can_decide` is computed when the list is read, and a bartender's window keeps
 * closing while he is standing there. So the card keeps counting: the line's age
 * is `seconds_since_lock` plus however long the request has been waiting, and the
 * buttons go away by themselves the second it crosses the window. Without that,
 * the queue would offer a button that had quietly become a 403 — and the server
 * would be the one to say so, after the tap.
 *
 * **The composition.** The table is the eyebrow, the request and the person are
 * the heading and the money is a `.metric` on the right — so the three questions
 * a decision needs ("where, what, how much") are three type steps rather than one
 * bold sentence. The line being struck sits under them at section size, because
 * that is the fact being decided; the chips are the footnotes.
 *
 * *Odobri* is the primary and *Odbij* is a secondary, deliberately: approving is
 * the common, low-harm answer, and a rejection leaves a waiter's money on his own
 * envelope, so it should take the more deliberate tap. Both are 56 px — a wrong
 * tap here moves real money.
 */
import { formatKm } from '#shared/money'
import { reasonLabel } from '~/composables/useAdjustments'
import type { PendingAdjustment } from '#shared/types'

const props = withDefaults(defineProps<{
  row: PendingAdjustment
  /** One clock for the whole screen, so "čeka 4 min" keeps counting. */
  now: number
  /**
   * `bartender_approve_window_s`, or `null` for an owner — his authority has no
   * window, so nothing here should take his buttons away.
   */
  windowS?: number | null
  busy?: boolean
}>(), { windowS: null, busy: false })

const emit = defineEmits<{
  decide: [id: string, outcome: 'applied' | 'rejected']
}>()

const isVoid = computed(() => props.row.kind === 'void')
const waiting = computed(() => ticketAge(props.row.created_at, props.now))

/** How old the *line* is now: its age when the storno was asked for, plus the wait. */
const lineAgeS = computed(() =>
  props.row.seconds_since_lock + ticketAgeSeconds(props.row.created_at, props.now))

const expired = computed(() => props.windowS !== null && lineAgeS.value > props.windowS)
const decidable = computed(() => props.row.can_decide && !expired.value)
</script>

<template>
  <article class="adj">
    <header class="adj-head">
      <div class="adj-who">
        <p class="eyebrow adj-kind">{{ row.table_name }}</p>
        <h2 class="adj-name">{{ isVoid ? 'Storno' : 'Na račun kuće' }} · {{ row.requested_by_name }}</h2>
      </div>
      <span class="metric adj-amount">{{ formatKm(row.amount_fen) }}</span>
    </header>

    <p class="adj-line">
      <span class="num adj-qty">{{ row.qty }}×</span>
      <span class="adj-item">{{ row.line_name }}</span>
    </p>

    <div class="adj-chips">
      <span class="chip">{{ reasonLabel(row.reason) }}</span>
      <span v-if="isVoid" class="chip" :class="row.restock ? 'chip-good' : ''">
        {{ row.restock ? 'vraća na stanje' : 'ne vraća na stanje' }}
      </span>
      <span v-if="row.was_paid" class="chip chip-danger">nakon naplate</span>
      <span class="num adj-waiting">{{ waiting }}</span>
    </div>

    <p v-if="row.note" class="adj-note">„{{ row.note }}“</p>

    <div v-if="decidable" class="adj-acts">
      <button
        type="button"
        class="btn btn-primary btn-lg adj-yes"
        :disabled="busy"
        @click="emit('decide', row.id, 'applied')"
      >
        <svg
          width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        >
          <path d="M5 12.5l4.5 4.5L19 7" />
        </svg>
        Odobri
      </button>
      <button
        type="button"
        class="btn btn-secondary btn-lg adj-no"
        :disabled="busy"
        @click="emit('decide', row.id, 'rejected')"
      >
        Odbij
      </button>
    </div>

    <p v-else class="note note-warn">
      Ide vlasniku — isteklo je vrijeme za šankera.
    </p>
  </article>
</template>

<style scoped>
.adj {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
}

.adj-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.adj-who {
  flex: 1;
  min-width: 0;
}

.adj-kind {
  margin: 0;
}

/*
 * The table is the eyebrow and the request is the heading: scanning a queue of
 * these, "which table" is what the eye needs first, while the heading is what a
 * screen reader reads and has to name the request in full on its own.
 */
.adj-name {
  margin: 2px 0 0;
  font-size: var(--text-section);
  line-height: 1.3;
  font-weight: 600;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.adj-amount {
  flex-shrink: 0;
  color: var(--ink);
}

/* The line being decided: the fact, at section size. */
.adj-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  padding-top: 12px;
  border-top: 1px solid var(--line-soft);
  font-size: var(--text-section);
  color: var(--ink);
}

.adj-qty { font-weight: 700; flex-shrink: 0; }

.adj-item {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.adj-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.adj-waiting {
  font-size: var(--text-label);
  color: var(--muted);
}

/* The waiter's own words, in the well the rest of the app quotes people in. */
.adj-note {
  margin: 0;
  padding: 10px 14px;
  border-radius: var(--radius-field);
  background: var(--bg-2);
  border: 1px solid var(--line-soft);
  font-size: var(--text-label);
  color: var(--ink-2);
}

.adj-acts {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

/* Approving is the common answer and gets the wider half of the row. */
.adj-yes { flex: 1.4; }
.adj-no { flex: 1; }
</style>
