<script setup lang="ts">
/**
 * The bartender's whole navigation: two pills, always in reach of a thumb.
 *
 * `sticky bottom-0` keeps the bar on screen while the ticket list scrolls; the
 * negative margin lets it run edge to edge inside the layout's `px-4` column.
 */
defineProps<{ active: 'narudzbe' | 'stanje' }>()

const PILL = 'flex min-h-12 flex-1 items-center justify-center rounded-full border text-base font-semibold'
const ON = 'bg-accent text-accent-ink border-accent'
const OFF = 'bg-surface-2 text-text-2 border-line'
</script>

<template>
  <nav class="sticky bottom-0 -mx-4 mt-2 flex gap-2 border-t border-line bg-bg px-4 pb-4 pt-3">
    <NuxtLink to="/s" :class="[PILL, active === 'narudzbe' ? ON : OFF]">
      Narudžbe
    </NuxtLink>
    <NuxtLink to="/stanje" :class="[PILL, active === 'stanje' ? ON : OFF]">
      Stanje šanka
    </NuxtLink>
  </nav>
</template>
