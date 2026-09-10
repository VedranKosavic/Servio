<script setup lang="ts">
/**
 * One ticket: a table, a waiter, a time, the lines, and *Gotovo*.
 *
 * No prices anywhere — the bartender does not see money in this app (PLAN.md
 * §2). `now` is passed in rather than read here so every card on the screen
 * ages against the same clock tick instead of running its own timer.
 *
 * **What this card is for.** It is read across a bar counter, at midnight, by
 * somebody holding a jug in the other hand. So the hierarchy is only three
 * things deep and it is the same three every time:
 *
 *   1. **the table**, at `--text-metric` in the display face — the one word that
 *      says where the round goes;
 *   2. **the lines**, at `--text-section`, with the quantity in a fixed tabular
 *      column so a stack of tickets reads as a column of numbers;
 *   3. **Gotovo**, 56 px of copper, full width, on every open ticket.
 *
 * Everything else — the waiter, the clock time, the age — is a caption. It was
 * previously bold and on the same line as the table name, which is why the old
 * card had no first thing to look at.
 *
 * **Why every open ticket gets the copper button.** The queue used to give the
 * accent to the oldest ticket and a hairline ghost to the rest, and in a dark
 * room a ghost button on a dark card is a button nobody can see. `primary` is
 * still the queue's "make this next" — it just says so with the *NA REDU*
 * eyebrow instead of by taking the other tickets' buttons away. The button is
 * also the last thing in the card with 12 px of its own above it, so the tap
 * that finishes Sto 12 cannot land on Sto 7.
 */
import type { PrepOrder } from '#shared/types'

const props = defineProps<{
  order: PrepOrder
  /** `Date.now()`, ticking in the page every couple of seconds. */
  now: number
  /** A finished ticket: one quiet row, no button, shows when it was done. */
  done?: boolean
  /** The queue's first ticket is the one to make next; it says so. */
  primary?: boolean
  busy?: boolean
}>()

const emit = defineEmits<{ done: [order: PrepOrder] }>()

const ageSeconds = computed(() => ticketAgeSeconds(props.order.created_at, props.now))

/** Under half a minute old: still *NOVO*. */
const isNew = computed(() => !props.done && ageSeconds.value <= 30)

/**
 * Six minutes is where a round starts being late in a lounge: a coffee and a
 * bowl are both out by then. The age turns amber rather than shouting — nothing
 * is wrong yet, it is just the ticket to pick up.
 */
const LATE_S = 360
const late = computed(() => !props.done && ageSeconds.value >= LATE_S)

const age = computed(() => ticketAge(props.order.created_at, props.now))

/**
 * The flavours as the bar reads them.
 *
 * A stock item is named "Al Fakher · Jabuka", so two flavours on one bowl print
 * as "Al Fakher · Jabuka + Al Fakher · Menta" — twenty-eight characters of brand
 * for six characters of information, wrapping onto three lines. The jars behind
 * the bar are all one brand, so the tail is what is actually read off the ticket.
 * Display only: the line's `flavours` are untouched everywhere else.
 */
function flavourText(flavours: string[]): string {
  return flavours.map(name => name.split(' · ').at(-1) ?? name).join(' + ')
}
</script>

<template>
  <!-- Finished: one row, because the only question it answers is "did that
       round for Sto 12 go out?" -->
  <article v-if="done" class="tk tk-done">
    <span class="tk-done-table num">{{ order.table_name }}</span>
    <span class="tk-done-who">{{ order.waiter_name }}</span>
    <span class="tk-done-at num">gotovo {{ clockHm(order.prepared_at) }}</span>
  </article>

  <article v-else class="tk" :class="{ 'tk-next': primary }">
    <header class="tk-head">
      <div class="tk-head-lines">
        <p v-if="primary" class="eyebrow tk-next-label">Na redu</p>
        <h3 class="metric tk-table">{{ order.table_name }}</h3>
        <p class="tk-meta num">{{ order.waiter_name }} · {{ clockHm(order.created_at) }}</p>
      </div>

      <div class="tk-age">
        <span v-if="isNew" class="chip chip-accent">Novo</span>
        <span class="num tk-age-text" :class="{ late }">{{ age }}</span>
      </div>
    </header>

    <p v-if="order.note" class="note note-warn tk-note">{{ order.note }}</p>

    <ul class="tk-lines">
      <li v-for="(line, index) in order.lines" :key="index" class="tk-line">
        <span class="num tk-qty">{{ line.qty }}×</span>
        <span class="tk-body">
          <span class="tk-name">{{ line.name_snapshot }}</span>
          <span v-if="line.flavours.length" class="tk-flavours">
            {{ flavourText(line.flavours) }}
          </span>
          <span v-if="line.note" class="tk-line-note">{{ line.note }}</span>
        </span>
      </li>
    </ul>

    <button
      type="button"
      class="btn btn-primary btn-lg tk-done-btn"
      :disabled="busy"
      @click="emit('done', order)"
    >
      <svg
        width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      >
        <path d="M5 12l5 5L20 7" />
      </svg>
      Gotovo
    </button>
  </article>
</template>

<style scoped>
.tk {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
}

/* The one to make next. A copper edge on the left, which is the same "this is
   the live one" copper the primary button carries — not a second colour. */
.tk-next {
  border-left: 3px solid var(--accent);
  padding-left: 14px;
}

.tk-next-label {
  margin: 0 0 2px;
  color: var(--accent-text);
}

.tk-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.tk-head-lines {
  flex: 1;
  min-width: 0;
}

.tk-table {
  margin: 0;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The waiter and the clock: a caption, never competing with the table. */
.tk-meta {
  margin: 4px 0 0;
  font-size: var(--text-label);
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tk-age {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  flex-shrink: 0;
  padding-top: 2px;
}

.tk-age-text {
  font-size: var(--text-label);
  color: var(--muted);
}

.tk-age-text.late { color: var(--warn); }

.tk-note { margin: 0; }

.tk-lines {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 12px 0 0;
  list-style: none;
  border-top: 1px solid var(--line-soft);
}

.tk-line {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

/* A fixed tabular column, so a card of four lines reads as a column of
   quantities rather than four sentences that happen to start with a digit. */
.tk-qty {
  flex-shrink: 0;
  width: 40px;
  text-align: right;
  font-size: var(--text-section);
  font-weight: 700;
  color: var(--ink);
}

.tk-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tk-name {
  font-size: var(--text-section);
  line-height: 1.3;
  color: var(--ink);
}

.tk-flavours {
  font-size: var(--text-label);
  color: var(--ink-2);
}

.tk-line-note {
  font-size: var(--text-label);
  color: var(--muted);
}

/* Its own air above it: the tap that finishes one ticket must not be able to
   land on the next one. */
.tk-done-btn {
  width: 100%;
  margin-top: 4px;
}

/* ---- the finished row -------------------------------------------------- */

/* Inside the collapsed tail these are rows of one card, not seven little
   cards: the question is "is Sto 12 on this list", and a list answers it. */
.tk-done {
  flex-direction: row;
  align-items: baseline;
  gap: 10px;
  min-height: 48px;
  padding: 10px 0;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--line-soft);
  border-radius: 0;
  color: var(--ink-2);
}

.tk-done-table {
  font-weight: 600;
  color: var(--ink-2);
  flex-shrink: 0;
}

.tk-done-who {
  flex: 1;
  min-width: 0;
  font-size: var(--text-label);
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tk-done-at {
  flex-shrink: 0;
  font-size: var(--text-label);
  color: var(--muted);
}
</style>
