<script setup lang="ts">
/**
 * One table of the owner's floor plan — the waiter's `FloorTable` in the other
 * material.
 *
 * **Why it is the same square.** `/konobar` draws the room as rounded squares
 * laid out where the tables actually stand, and the owner asked for that screen
 * rather than the four-across list *Puls* used to draw: a table in this room is
 * square, and a plan you can point at is a plan you can read across a bar. The
 * shape, the size and the geometry are the waiter's; nothing here is imported
 * from his component and no rule here is shared with it, because `/konobar` is
 * dark, `/admin` is light, and the two never share a CSS rule.
 *
 * **What the tile says is the owner's, not the waiter's.** A waiter's tile
 * answers *is this mine*; the owner has no table of his own, so the three facts
 * he is watching go on it instead: the number, what is still owed on it, and
 * how long the guests have been sitting there.
 *
 * **State is material first, colour second** (DESIGN §2). A free table is the
 * quietest thing on the plan — the well's own step with a muted number. An
 * occupied one is a soft tint of the age band, and the age is printed on the
 * tile in words as well, because a colour on its own is not a status a
 * colour-blind owner, a printed screenshot or a bright afternoon can read.
 *
 * `pending_review` — *naplata čeka*, somebody has to look at this one — is a
 * ring rather than a fourth tint, so the tile still says how old it is. The
 * legend at the foot of the plan names it in a word.
 */
import type { PulsFloorCell } from '~/utils/puls'

defineProps<{ cell: PulsFloorCell }>()

defineEmits<{ open: [] }>()
</script>

<template>
  <component
    :is="cell.tab_id ? 'button' : 'div'"
    class="a-tbl"
    :class="[`h-${cell.tone}`, { wait: cell.pending_review }]"
    :type="cell.tab_id ? 'button' : undefined"
    :aria-label="cell.tab_id ? `${cell.name}, ${formatKm(cell.remaining_fen)}, ${cell.age}` : cell.name"
    @click="cell.tab_id && $emit('open')"
  >
    <span class="a-tbl-no">{{ cell.label }}</span>
    <template v-if="cell.tab_id">
      <span class="a-tbl-amt num">{{ formatAmount(cell.remaining_fen) }}</span>
      <span class="a-tbl-age num">{{ cell.age }}</span>
    </template>
  </component>
</template>

<style scoped>
.a-tbl {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  width: 76px;
  height: 76px;
  flex-shrink: 0;
  padding: 0 4px;
  border-radius: var(--radius-card);
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink-2);
  font: inherit;
  text-align: center;
  min-width: 0;
  transition:
    transform var(--dur-tap) var(--ease-standard),
    box-shadow var(--dur-fast) var(--ease-standard);
}

button.a-tbl { cursor: pointer; }
button.a-tbl:hover { box-shadow: var(--shadow-raise); }
button.a-tbl:active { transform: scale(0.97); }
button.a-tbl:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.a-tbl-no {
  font-family: var(--font-display);
  font-size: var(--text-section);
  line-height: 1.1;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--ink);
}

/* The amount is what the owner is watching, so it takes the readable step and
   the full width of the tile — which is the whole reason the tile is a square
   and not a circle. */
.a-tbl-amt {
  max-width: 100%;
  font-size: var(--text-label);
  line-height: 1.2;
  font-weight: 600;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Below the amount on purpose: the age is the tile's second encoding of the
   tint and must never compete with the money. */
.a-tbl-age {
  font-size: var(--text-caption);
  line-height: 1.2;
  letter-spacing: 0;
  color: var(--muted);
  white-space: nowrap;
}

/* Free: the quietest step there is — the well's own ground, a soft rule, a
   muted number, and nothing else on it. */
.h-free {
  background: transparent;
  border-color: var(--line-soft);
}

.h-free .a-tbl-no { color: var(--muted); }

.h-fresh { background: var(--good-soft); border-color: var(--line-soft); }
.h-warm { background: var(--warn-soft); border-color: var(--line-soft); }
.h-old { background: var(--danger-soft); border-color: var(--line-soft); }

/* The tint carries the heat; the figures stay ink, or the plan turns into
   three colours of text nobody can read a number out of. */
.h-fresh .a-tbl-amt, .h-warm .a-tbl-amt, .h-old .a-tbl-amt { color: var(--ink); }

/* Somebody has to look at this one. A ring, so the tint still says how old it
   is — and *čeka* is in the legend, because a ring is not a word. */
.a-tbl.wait {
  outline: 2px solid var(--warn);
  outline-offset: 2px;
}

/**
 * The tile shrinks so the room fits, rather than the room scrolling.
 *
 * *Unutra* is three runs of tables with the VIP pair boxed under the third, so
 * the widest line of the plan is four tiles plus the box's own edge — which at
 * 76 px is wider than a 390 px phone, and wider still than a 360 px one. The
 * two steps down keep the whole room on the screen at both, and 60 px still
 * carries the number, the amount and the age on three legible lines.
 */
@media (max-width: 440px) {
  .a-tbl { width: 64px; height: 68px; }
}

@media (max-width: 370px) {
  .a-tbl { width: 60px; height: 66px; }
}
</style>
