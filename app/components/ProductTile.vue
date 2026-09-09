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
 * Zaključi*. That is deliberate — a third control on a 96 px tile would cost
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
      class="card flex min-h-24 w-full select-none flex-col justify-between gap-2 p-2.5 text-left"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="clear"
      @pointercancel="clear"
      @pointerleave="clear"
      @contextmenu.prevent
      @click="onClick"
    >
      <span class="flex w-full items-start justify-between gap-1">
        <span class="text-base font-semibold leading-tight">{{ label }}</span>
        <span v-if="shisha" class="shrink-0 text-accent">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 1-3-1-5 1-9z" />
          </svg>
        </span>
      </span>
      <span class="num text-sm text-text-2">{{ formatKm(priceFen) }}</span>
    </button>

    <span
      v-if="qty > 0"
      class="num absolute -right-2 -top-2 flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-bg bg-accent px-1.5 text-sm font-bold text-accent-ink"
    >{{ qty }}</span>

    <button
      v-if="qty > 0"
      type="button"
      class="absolute bottom-0 right-0 flex h-12 w-12 items-center justify-center rounded-br-[14px] rounded-tl-xl bg-surface-2 text-xl font-bold text-text"
      :aria-label="`Skini jedan · ${name}`"
      @click.stop="emit('remove')"
    >
      −
    </button>
  </div>
</template>
