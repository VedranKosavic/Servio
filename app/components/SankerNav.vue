<script setup lang="ts">
/**
 * The bartender's whole navigation: three pills, always in reach of a thumb.
 *
 * All three are listed from day one; *Na čekanju* rendered greyed out with
 * *stiže uskoro* until WP1 built `/sanker/cekanje` — a nav that grows a tab every
 * week teaches nobody where anything is. The one line WP1 changes here is the
 * flag below, which WP0 left for it.
 *
 * `sticky bottom-0` keeps the bar on screen while the ticket list scrolls; the
 * negative margin lets it run edge to edge inside the layout's `px-4` column.
 */
defineProps<{ active: 'narudzbe' | 'cekanje' | 'stanje' }>()

/** Flipped by the PR that landed `/sanker/cekanje` (WP1). */
const CEKANJE_READY = true

const PILL = 'flex min-h-12 flex-1 items-center justify-center rounded-full border text-base font-semibold'
const ON = 'bg-accent text-accent-ink border-accent'
const OFF = 'bg-surface-2 text-text-2 border-line'
const DISABLED = 'bg-surface-2 text-muted border-line'
</script>

<template>
  <nav class="sticky bottom-0 -mx-4 mt-2 flex gap-2 border-t border-line bg-bg px-4 pb-4 pt-3">
    <NuxtLink to="/sanker" :class="[PILL, active === 'narudzbe' ? ON : OFF]">
      Narudžbe
    </NuxtLink>

    <NuxtLink
      v-if="CEKANJE_READY"
      to="/sanker/cekanje"
      :class="[PILL, active === 'cekanje' ? ON : OFF]"
    >
      Na čekanju
    </NuxtLink>
    <span v-else :class="[PILL, DISABLED]" aria-disabled="true" title="stiže uskoro">
      Na čekanju
    </span>

    <NuxtLink to="/stanje" :class="[PILL, active === 'stanje' ? ON : OFF]">
      Stanje šanka
    </NuxtLink>
  </nav>
</template>
