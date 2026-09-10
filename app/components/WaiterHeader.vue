<script setup lang="ts">
/**
 * The bar across the top of every waiter screen: an optional back arrow, the
 * title, an optional quiet second line, and whatever the screen wants on the
 * right (a sync chip, an avatar, a total).
 *
 * It sticks to the top while the screen scrolls, and the negative margin
 * cancels the layout's side padding so the hairline runs the full width. The
 * ground is the page's own `--bg` rather than a card, so the header is the top
 * of the page and not a slab sitting on it.
 *
 * **Type.** The title is `.page-title` — the display face at 24 px, which is the
 * one step that says "this is the name of the screen" without shouting. `sub`
 * is the `.eyebrow` under it and takes the small fact a screen would otherwise
 * bury at the bottom (how many tables are open, whose shift this is).
 *
 * **Every dark screen's header is this one.** `SankerHeader` is this component
 * with the sync chip and the avatar in the `right` slot — the bartender bar is
 * a usage, not a second implementation, so the two areas cannot drift.
 */
defineProps<{
  title: string
  /** Where the back arrow goes. Omitted on a top-level screen. */
  backTo?: string
  /** The quiet line under the title. A fact, never a sentence. */
  sub?: string | null
}>()
</script>

<template>
  <header
    class="sticky top-0 z-30 -mx-4 flex min-h-16 items-center gap-3 border-b border-line bg-bg px-4 py-2"
  >
    <NuxtLink
      v-if="backTo"
      :to="backTo"
      class="-ml-2 flex shrink-0 items-center justify-center rounded-control text-text-2 transition-colors active:bg-surface-2"
      :style="{ width: 'var(--tap)', height: 'var(--tap)' }"
      aria-label="Nazad"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </NuxtLink>

    <div class="flex min-w-0 grow flex-col justify-center">
      <!--
        An `h1`, not a styled span: this *is* the name of the screen, and it is
        the landmark a screen reader jumps to. `.page-title` carries the size,
        so the tag is free to be the honest one.
      -->
      <h1 class="page-title m-0 truncate">{{ title }}</h1>
      <p v-if="sub" class="eyebrow m-0 truncate">{{ sub }}</p>
    </div>

    <slot name="right" />
  </header>
</template>
