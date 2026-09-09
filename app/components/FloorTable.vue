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
  small?: boolean
}>(), { sub: null, attention: false, late: false, small: false })

defineEmits<{ select: [] }>()
</script>

<template>
  <button
    type="button"
    class="relative flex shrink-0 flex-col items-center justify-center rounded-full border-2 font-bold leading-none"
    :class="[
      small ? 'h-[46px] w-[46px] text-sm' : 'h-14 w-14 text-base',
      variant === 'mine' ? 'border-accent bg-accent text-accent-ink' : '',
      variant === 'other' ? 'border-line bg-line text-text' : '',
      variant === 'free' ? 'border-line bg-surface text-text' : '',
      variant === 'offered' ? 'border-dashed border-accent bg-surface-2 text-text' : '',
      attention ? 'outline outline-2 outline-offset-2 outline-warn' : '',
    ]"
    @click="$emit('select')"
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
