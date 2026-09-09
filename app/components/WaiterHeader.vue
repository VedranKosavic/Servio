<script setup lang="ts">
/**
 * The bar across the top of every waiter screen: an optional back arrow, the
 * title, and whatever the screen wants on the right (a sync chip, an avatar, a
 * total).
 *
 * It sticks to the top while the screen scrolls, and the negative margin
 * cancels the layout's side padding so the hairline runs the full width.
 *
 * The bartender screens bring their own header — this one is not shared.
 */
defineProps<{
  title: string
  /** Where the back arrow goes. Omitted on a top-level screen. */
  backTo?: string
}>()
</script>

<template>
  <header class="sticky top-0 z-30 -mx-4 flex min-h-14 items-center gap-2.5 border-b border-line bg-bg px-4 py-2">
    <NuxtLink
      v-if="backTo"
      :to="backTo"
      class="-ml-3 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-text"
      aria-label="Nazad"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </NuxtLink>

    <span class="grow truncate text-xl font-bold">{{ title }}</span>

    <slot name="right" />
  </header>
</template>
