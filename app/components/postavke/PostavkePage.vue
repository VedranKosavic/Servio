<script setup lang="ts">
/**
 * The frame every *Meni i postavke* screen sits in: the Bricolage title, the
 * one-line explanation, a slot for the page's own buttons, the tab strip, and
 * one place for the error sentence a failed write leaves behind.
 *
 * It exists so that six screens share one head instead of six copies of the same
 * twenty lines of CSS drifting apart over a year.
 */
defineProps<{
  title: string
  sub?: string
  /** The Bosnian sentence from `apiErrorText`, when the last write failed. */
  error?: string | null
  /** A screen that has not finished its first read draws skeletons, not numbers. */
  loading?: boolean
}>()
</script>

<template>
  <div class="p-page">
    <UiPageHead eyebrow="Meni i postavke" :title="title" :sub="sub">
      <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    </UiPageHead>

    <PostavkeTabs />

    <p v-if="error" class="p-error" role="alert">{{ error }}</p>

    <slot />
  </div>
</template>

<style scoped>
.p-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

/**
 * A wide table must scroll inside its own box and never drag the page sideways.
 *
 * `UiTable` already puts `overflow-x: auto` on its wrapper and the table is
 * clipped correctly — but Chromium still adds the table's full width to the
 * *document's* scrollable overflow, so a 390 px phone can be dragged 229 px to
 * the right into empty background. `contain: paint` tells the browser nothing
 * inside that box paints outside it, which stops the leak and changes no
 * layout: the table still scrolls within its wrapper.
 *
 * It belongs in `app/components/ui/UiTable.vue`, which is WP0's file — see the
 * PR body.
 */
.p-page :deep(.a-table-wrap) { contain: paint; }

.p-error {
  margin: 0;
  padding: 10px 14px;
  border-radius: var(--radius-field);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: var(--text-label);
  font-weight: 500;
}
</style>
