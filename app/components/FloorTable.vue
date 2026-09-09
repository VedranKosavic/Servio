<script setup lang="ts">
/**
 * One table on the floor plan: a circle with its number, and under it either
 * the amount running on it (mine) or the initials of the colleague who opened
 * it. Free tables are drawn as an outline only, so a busy room reads at a
 * glance as "the filled ones need me".
 *
 * The circle is 56 px — a thumb — and shrinks to 46 px only in the long bašta
 * row, where seven of them share the width of a phone.
 */
withDefaults(defineProps<{
  /** The number alone: "Sto 7" is stripped to "7" before it gets here. */
  label: string
  /** The second line: an amount for my tables, initials for a colleague's. */
  sub?: string | null
  variant: 'free' | 'mine' | 'other'
  small?: boolean
}>(), { sub: null, small: false })

defineEmits<{ select: [] }>()
</script>

<template>
  <button
    type="button"
    class="flex shrink-0 flex-col items-center justify-center rounded-full border-2 font-bold leading-none"
    :class="[
      small ? 'h-[46px] w-[46px] text-sm' : 'h-14 w-14 text-base',
      variant === 'mine' ? 'border-accent bg-accent text-accent-ink' : '',
      variant === 'other' ? 'border-line bg-line text-text' : '',
      variant === 'free' ? 'border-line bg-surface text-text' : '',
    ]"
    @click="$emit('select')"
  >
    <span>{{ label }}</span>
    <small v-if="sub" class="num mt-[3px] text-[10px] font-semibold opacity-90">{{ sub }}</small>
  </button>
</template>
