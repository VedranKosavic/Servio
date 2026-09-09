<script setup lang="ts">
/**
 * One table on the floor plan: a circle with its number, and under it either the
 * amount still owed on it (mine) or the initials of the colleague holding it.
 * Free tables are drawn as an outline only, so a busy room reads at a glance as
 * "the filled ones need me".
 *
 * Three states ride on top of the colour, because they are things a waiter has
 * to *notice* rather than read:
 *
 *   `attention`  the tab is flagged `pending_review` — somebody has to look at
 *                it: a payment that did not cover every round on it, or a tab
 *                marked unpaid and not yet decided. A warm ring, not a colour
 *                change, so the tile still says whose it is.
 *   `offered`    a colleague has offered you the table and you have not taken
 *                it. Dashed, because it is not yours until you tap *Prihvati*.
 *   `late`       a round on it arrived long after it was ordered (the phone was
 *                offline). A small amber dot: the money is right, the clock is
 *                not.
 *
 * The circle is 56 px — a thumb — and shrinks to 46 px only in the long bašta
 * row, where seven of them share the width of a phone.
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
  small?: boolean
}>(), { sub: null, attention: false, late: false, draft: false, small: false })

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
    class="relative flex shrink-0 select-none flex-col items-center justify-center rounded-full border-2 font-bold leading-none"
    :class="[
      small ? 'h-[46px] w-[46px] text-sm' : 'h-14 w-14 text-base',
      variant === 'mine' ? 'border-accent bg-accent text-accent-ink' : '',
      variant === 'other' ? 'border-line bg-line text-text' : '',
      variant === 'free' ? 'border-line bg-surface text-text' : '',
      variant === 'offered' ? 'border-dashed border-accent bg-surface-2 text-text' : '',
      draft ? 'border-dashed' : '',
      attention ? 'outline outline-2 outline-offset-2 outline-warn' : '',
    ]"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="clear"
    @pointercancel="clear"
    @pointerleave="clear"
    @contextmenu.prevent
    @click="onClick"
  >
    <span>{{ label }}</span>
    <small v-if="sub" class="num mt-[3px] text-[10px] font-semibold opacity-90">{{ sub }}</small>

    <!-- The round arrived late. One dot; the tab sheet explains it. -->
    <span
      v-if="late"
      class="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border border-bg bg-warn"
      aria-label="Kasno sinhronizovano"
    />
  </button>
</template>
