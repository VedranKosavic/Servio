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
 * The tile is 68 px everywhere — a thumb with room to spare.
 */
withDefaults(defineProps<{
  /** The number alone: "Sto 7" is stripped to "7" before it gets here. */
  label: string
  /** The second line: an amount for my tables, initials for a colleague's. */
  sub?: string | null
  variant: 'free' | 'mine' | 'other' | 'offered'
  /** `pending_review`: naplata čeka. */
  attention?: boolean
  /** `late_sync`: the round reached the server long after it happened. */
  late?: boolean
  /** A round on this table is still on the phone — dashed, "nacrt" or "čeka". */
  draft?: boolean
}>(), { sub: null, attention: false, late: false, draft: false })

const emit = defineEmits<{ select: [], long: [] }>()

/**
 * The long press: *Žar* on a table with a live nargila, in two taps (F4).
 *
 * Same shape as the one on `ProductTile` — pointer events so a mouse and a
 * thumb take one code path, cancelled the moment the finger travels, and the
 * click that follows a fired press is swallowed so opening the sheet does not
 * also open the table. Its button twin is the inline *Žar* chip on the shisha
 * line inside S2 (PLAN §10, invariant 7).
 */
const LONG_PRESS_MS = 450
const MOVE_TOLERANCE_PX = 10

let timer: ReturnType<typeof setTimeout> | null = null
let start: { x: number, y: number } | null = null
const fired = ref(false)

function clear() {
  if (timer) clearTimeout(timer)
  timer = null
  start = null
}

function onPointerDown(event: PointerEvent) {
  fired.value = false
  start = { x: event.clientX, y: event.clientY }
  timer = setTimeout(() => {
    fired.value = true
    if (import.meta.client && 'vibrate' in navigator) navigator.vibrate(12)
    emit('long')
  }, LONG_PRESS_MS)
}

function onPointerMove(event: PointerEvent) {
  if (!start) return
  const moved = Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y)
  if (moved > MOVE_TOLERANCE_PX) clear()
}

function onClick() {
  if (fired.value) {
    fired.value = false
    return
  }
  emit('select')
}
</script>

<template>
  <button
    type="button"
    class="table-tile"
    :class="[variant, { draft, attention }]"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="clear"
    @pointercancel="clear"
    @pointerleave="clear"
    @contextmenu.prevent
    @click="onClick"
  >
    <span class="tile-no">{{ label }}</span>
    <small v-if="sub" class="tile-sub num">{{ sub }}</small>

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
  gap: 2px;
  width: 68px;
  height: 68px;
  flex-shrink: 0;
  border-radius: var(--radius-card);
  border: 1.5px solid var(--line-soft);
  background: var(--surface);
  color: var(--muted);
  cursor: pointer;
  transition:
    transform var(--dur-tap) var(--ease-standard),
    background var(--dur-fast) var(--ease-standard);
}

.table-tile:active {
  transform: scale(0.95);
}

.tile-no {
  font-family: var(--font-display);
  font-size: var(--text-section);
  line-height: 1;
  font-weight: 700;
  letter-spacing: -0.01em;
}

/* The amount, and the whole reason the tile is no longer a circle: it gets the
   full width of the tile and a real type step instead of 10 px in a corner. */
.tile-sub {
  max-width: 100%;
  font-size: var(--text-label);
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

/* A colleague's: raised material with an edge you can see. */
.table-tile.other {
  background: var(--surface-2);
  border-color: var(--line);
  color: var(--ink-2);
}

.table-tile.other .tile-no { color: var(--ink); }

/* Mine: the only copper on the plan. */
.table-tile.mine {
  background: var(--accent);
  border-color: transparent;
  color: var(--on-accent);
}

.table-tile.mine .tile-no,
.table-tile.mine .tile-sub { color: var(--on-accent); }

/* Offered and not taken: copper, but not filled — it is not yours yet. */
.table-tile.offered {
  background: var(--accent-soft);
  border-color: var(--accent-line);
  border-style: dashed;
  color: var(--accent-text);
}

.table-tile.offered .tile-no { color: var(--accent-text); }

/* Still on the phone: the same dash that means "not committed" everywhere. */
.table-tile.draft { border-style: dashed; }

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
