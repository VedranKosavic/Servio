<script setup lang="ts">
/**
 * One item on *Dodaj*. A tap anywhere on the tile is +1 — that is the whole
 * interaction, and it has to survive a thumb in a dark room.
 *
 * The "−" only appears once something is on the tile, and it is its own 48 px
 * button sitting on top of the tile rather than inside it: a button inside a
 * button is invalid HTML, so the tile is a button and the minus is a sibling
 * placed over its corner.
 *
 * **The long press** (Phase 3) opens the note chips — *bez šećera*, *s
 * mlijekom* — or, on the *Ostalo* tile, the free text that becomes the line's
 * note. It is implemented on pointer events rather than `touchstart`, so it
 * works with a mouse in a browser and with a finger on a phone from one code
 * path, and it is cancelled the moment the finger moves 10 px, because a press
 * that turns into a scroll is a scroll.
 *
 * PLAN §10 invariant 7 requires a button twin for every gesture, and this one
 * has it off-tile: the same sheet opens from the ⋯ on each line of *Pregled ·
 * Zaključi*. That is deliberate — a third control on a 100 px tile would cost
 * more taps than the gesture saves.
 */
import { formatKm } from '#shared/money'

const props = withDefaults(defineProps<{
  name: string
  /** What fits on a 3-column tile; the full name is the fallback. */
  shortName?: string | null
  priceFen: number
  /** How many are already on the draft round. 0 hides the badge and the "−". */
  qty: number
  /** Nargila: the tap opens the aroma sheet instead of adding straight away. */
  shisha?: boolean
}>(), { shortName: null, shisha: false })

const emit = defineEmits<{ add: [], remove: [], long: [] }>()

/** Long enough not to fire on a firm tap, short enough not to feel broken. */
const LONG_PRESS_MS = 450
const MOVE_TOLERANCE_PX = 10

let timer: ReturnType<typeof setTimeout> | null = null
let start: { x: number, y: number } | null = null
/** Set when the press fired, so the click it is followed by does not add one. */
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
    // A press that opens a sheet should feel like something happened. Only
    // where the browser has it — iOS Safari does not, and the sheet itself is
    // the feedback there.
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
  emit('add')
}

const label = computed(() => props.shortName ?? props.name)
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="tile-btn"
      :class="{ 'has-qty': qty > 0 }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="clear"
      @pointercancel="clear"
      @pointerleave="clear"
      @contextmenu.prevent
      @click="onClick"
    >
      <span class="flex w-full items-start justify-between gap-1">
        <span class="tile-name">{{ label }}</span>
        <span v-if="shisha" class="shrink-0 text-accent-text" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 1-3-1-5 1-9z" />
          </svg>
        </span>
      </span>
      <span class="num tile-price">{{ formatKm(priceFen) }}</span>
    </button>

    <span v-if="qty > 0" class="num tile-qty">{{ qty }}</span>

    <button
      v-if="qty > 0"
      type="button"
      class="tile-minus"
      :aria-label="`Skini jedan · ${name}`"
      @click.stop="emit('remove')"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
        <path d="M6 12h12" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
/**
 * The tile is a card, not a button-shaped thing: material, an edge, and the two
 * facts a waiter reads out loud — the name at body size and the price under it
 * in tabular figures.
 *
 * The price sits *under the name*, not at the far end of a stretched box.
 * `justify-content: space-between` pushed it to the bottom of whatever height
 * the grid row took from its tallest neighbour — roughly 60 px of nothing
 * between a name and the figure that belongs to it, so six favourites filled
 * the screen and the price a waiter has to check floated away from it. The
 * content packs at the top now and the 8 px gap does the spacing.
 *
 * The " KM" stays. `FloorPlan` drops the currency because every tile on it is
 * an amount and the unit is obvious from the column; here the price is the only
 * number on the tile, and the `/konobar` end-to-end specs identify a product
 * tile by it — a cosmetic edit is not a reason to loosen a guardrail locator.
 */
.tile-btn {
  display: flex;
  width: 100%;
  min-height: 100px;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 12px;
  text-align: left;
  user-select: none;
  border-radius: var(--radius-card);
  border: 1px solid var(--line);
  background: var(--surface);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-standard),
    transform var(--dur-tap) var(--ease-standard);
}

.tile-btn:active { transform: scale(0.97); background: var(--surface-2); }

.tile-name {
  font-size: var(--text-body);
  line-height: 1.2;
  font-weight: 600;
  color: var(--ink);
}

.tile-price {
  font-size: var(--text-label);
  font-weight: 500;
  color: var(--ink-2);
}

/* A three-across tile is 111 px wide on a 390 px phone, which is not enough for
   a price *and* a 48 px control on the same line — so the control hangs off the
   corner (below) and the price only has to clear its overhang. */
.tile-btn.has-qty .tile-price {
  padding-right: 26px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* How many are on the round. The one copper thing on the tile. */
.tile-qty {
  position: absolute;
  top: -8px;
  right: -6px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 7px;
  border-radius: var(--radius-chip);
  border: 2px solid var(--bg);
  background: var(--accent);
  color: var(--on-accent);
  font-size: var(--text-label);
  font-weight: 700;
}

/**
 * "−" is its own 48 px target sitting *on* the tile rather than inside it: a
 * button inside a button is invalid HTML, so the tile is a button and the minus
 * is a sibling placed over its corner. It only exists once something is on the
 * tile.
 */
.tile-minus {
  position: absolute;
  right: -6px;
  bottom: -6px;
  display: flex;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-chip);
  border: 2px solid var(--bg);
  background: var(--surface-3);
  color: var(--ink);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}

.tile-minus:active { background: var(--line); }
</style>
