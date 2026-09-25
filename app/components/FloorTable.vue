<script setup lang="ts">
/**
 * One table on the floor plan: its number, and under it either the amount still
 * owed on it (mine) or the initials of the colleague holding it.
 *
 * **Why it is a rounded square and no longer a circle.** The tile has to carry
 * an amount that is readable with the phone at arm's length, in a dark room,
 * while the other hand holds a tray. A circle narrows exactly where the second
 * line sits, which is why the amount used to be set at 10 px; the same tile
 * drawn at `--radius-card` gives that line the full width of the tile and lets
 * it be `--text-label` with tabular figures. The tile still reads as a table
 * from above — a table in this room is square.
 *
 * **State is material first, colour second** (DESIGN §2). A free table is the
 * quietest thing on the plan: the page's own well, a soft rule, a muted number.
 * A colleague's is a raised surface with a visible edge. Mine is the only
 * copper on the screen, because copper marks the person's own state and
 * nothing else — which is what makes "the filled copper ones need me" read
 * before any label does.
 *
 * Three things ride on top of that, because they are things a waiter has to
 * *notice* rather than read:
 *
 *   `attention`  the tab is flagged `pending_review` — somebody has to look at
 *                it: a payment that did not cover every round on it, or a tab
 *                marked unpaid and not yet decided. A warm ring, not a colour
 *                change, so the tile still says whose it is.
 *   `offered`    a colleague has offered you the table and you have not taken
 *                it. Dashed copper, because it is not yours until you tap
 *                *Prihvati*.
 *   `late`       a round on it arrived long after it was ordered (the phone was
 *                offline). A small amber dot: the money is right, the clock is
 *                not.
 *
 * **Its size is the room's.** The tile fills the spot `FloorRoom` gives it —
 * about 55 px on a phone — and its type is a multiple of the room's unit `--u`, so a
 * table the owner made wide is still one tile with its number in the middle.
 */
withDefaults(defineProps<{
  /** The number alone: "Sto 7" is stripped to "7" before it gets here. */
  label: string
  /** The second line: the amount owed, or the initials of whoever holds it. */
  sub?: string | null
  /**
   * **The shift serving this table, not whose table it is.**
   *
   * Copper used to mean "mine" and grey "a colleague's". The owner asked for
   * the colour to say which shift the table belongs to instead — *"we can
   * remove the gray, so gray should be just an empty table. If someone is
   * second shift, then assign him blue"* — because the question a waiter asks
   * walking in at three is not *is this mine* (there are one or two of them on
   * a shift) but *is this the morning's or mine*.
   */
  variant: 'free' | 'shift-a' | 'shift-b' | 'offered'
  /**
   * The money is in and the guests are still here: the tile keeps its shift
   * colour and gains a checkmark, and the only thing left to do to it is
   * *Očisti sto*.
   */
  paid?: boolean
  /** `pending_review`: naplata čeka. */
  attention?: boolean
  /** `late_sync`: the round reached the server long after it happened. */
  late?: boolean
  /** A round on this table is still on the phone — dashed, "nacrt" or "čeka". */
  draft?: boolean
  /** The table top the owner chose on *Stolovi*. */
  shape?: 'square' | 'round' | 'wide'
}>(), { sub: null, paid: false, attention: false, late: false, draft: false, shape: 'square' })

/**
 * A tap is the only thing a tile answers. The long press that used to add
 * *Dodatni žar* went with the product (the owner, 25.09.2026); a thumb that
 * still holds out of habit just opens the table, and `contextmenu` stays
 * swallowed so a held tile never pops the browser's own menu.
 */
const emit = defineEmits<{ select: [] }>()
</script>

<template>
  <button
    type="button"
    class="table-tile"
    :class="[variant, shape, { draft, attention, paid }]"
    @contextmenu.prevent
    @click="emit('select')"
  >
    <span class="tile-no">{{ label }}</span>

    <!-- Settled: the amount it came to is history, so the tile says the one
         thing still true about it. -->
    <svg
      v-if="paid" class="tile-tick" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-label="Naplaćeno"
    ><path d="M5 13l4 4L19 7" /></svg>
    <small v-else-if="sub" class="tile-sub num">{{ sub }}</small>

    <!-- The round arrived late. One dot; the tab sheet explains it. -->
    <span v-if="late" class="tile-late" aria-label="Kasno sinhronizovano" />
  </button>
</template>

<style scoped>
.table-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: calc(var(--u) * 0.4);
  width: 100%;
  height: 100%;
  padding: 0;
  border-radius: calc(var(--u) * 3.2);
  border: 1.5px solid var(--line);
  background: var(--surface-2);
  color: var(--muted);
  /* A table top standing on the floor, not a patch painted on it. */
  box-shadow: 0 calc(var(--u) * 1.2) calc(var(--u) * 2.4) calc(var(--u) * -1.2) var(--scrim);
  cursor: pointer;
  transition:
    transform var(--dur-tap) var(--ease-standard),
    background var(--dur-fast) var(--ease-standard);
}

.table-tile:active {
  transform: scale(0.95);
}

/* The target reaches a little past the top — where its chairs stand in the
   editor: in a wide room the top alone can be under 44 px on a small phone,
   and a thumb aimed at a table lands beside it as often as on it. */
.table-tile::before {
  content: '';
  position: absolute;
  inset: calc(var(--u) * -2.6);
}

.table-tile.round { border-radius: 50%; }

.tile-no {
  font-family: var(--font-display);
  font-size: clamp(15px, calc(var(--u) * 5.6), 24px);
  line-height: 1;
  font-weight: 700;
  letter-spacing: -0.01em;
}

/* The amount, and the whole reason the tile is no longer a circle: it gets the
   full width of the tile and a real type step instead of 10 px in a corner. */
.tile-sub {
  max-width: 92%;
  font-size: clamp(10px, calc(var(--u) * 3.5), 15px);
  line-height: 1.1;
  font-weight: 600;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Free: the quietest step of the ladder — one level above the well it sits in,
   and nothing else. */
.table-tile.free .tile-no { color: var(--ink-2); }

/**
 * **The first shift: copper. The second: blue.**
 *
 * The grey "a colleague's" tile is gone — grey is an empty table and nothing
 * else now. What a filled tile says is which shift is serving it, which is the
 * question at a handover; whose it is has moved to the second line, where a
 * colleague's initials already were.
 */
.table-tile.shift-a {
  background: var(--accent);
  border-color: transparent;
  color: var(--on-accent);
}

.table-tile.shift-a .tile-no,
.table-tile.shift-a .tile-sub,
.table-tile.shift-a .tile-tick { color: var(--on-accent); }

.table-tile.shift-b {
  background: var(--shift-b);
  border-color: transparent;
  color: var(--on-shift-b);
}

.table-tile.shift-b .tile-no,
.table-tile.shift-b .tile-sub,
.table-tile.shift-b .tile-tick { color: var(--on-shift-b); }

/**
 * Paid and still sitting there.
 *
 * The colour does not change — it is still that shift's table — so the tile is
 * dimmed a step and the amount is replaced by a checkmark. Dimmed rather than
 * recoloured because "settled" is a *state of* this shift's table, not a fourth
 * kind of table, and a waiter scanning the room should still see the shift
 * first.
 */
.table-tile.paid { opacity: 0.62; }

.tile-tick { width: clamp(16px, calc(var(--u) * 5.6), 24px); height: clamp(16px, calc(var(--u) * 5.6), 24px); }

/* Offered and not taken: copper, but not filled — it is not yours yet. */
.table-tile.offered {
  background: var(--accent-soft);
  border-color: var(--accent-line);
  border-style: dashed;
  color: var(--accent-text);
}

.table-tile.offered .tile-no { color: var(--accent-text); }

/* Still on the phone: the same dash that means "not committed" everywhere.
   `.mine` paints a filled copper tile with a transparent edge, so a dashed
   border alone drew nothing — a draft looked exactly like a locked, live tab.
   An unsent round therefore takes the not-committed material `.offered` uses,
   which is also what `.key-draft` in the legend draws. */
.table-tile.draft { border-style: dashed; }

.table-tile.mine.draft {
  background: var(--accent-soft);
  border-color: var(--accent-line);
  color: var(--accent-text);
}

.table-tile.mine.draft .tile-no,
.table-tile.mine.draft .tile-sub { color: var(--accent-text); }

/* Somebody has to look at this one. A ring, so the fill still says whose it is. */
.table-tile.attention {
  outline: 2px solid var(--warn);
  outline-offset: 2px;
}

.tile-late {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 12px;
  height: 12px;
  border-radius: var(--radius-chip);
  background: var(--warn);
  border: 2px solid var(--bg);
}
</style>
