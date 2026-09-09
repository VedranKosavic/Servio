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
    <header class="p-head">
      <div class="p-head-text">
        <h1>{{ title }}</h1>
        <p v-if="sub" class="p-sub">{{ sub }}</p>
      </div>
      <div v-if="$slots.actions" class="p-head-actions"><slot name="actions" /></div>
    </header>

    <PostavkeTabs />

    <p v-if="error" class="p-error" role="alert">{{ error }}</p>

    <slot />
  </div>
</template>

<style scoped>
.p-page { display: flex; flex-direction: column; gap: 18px; min-width: 0; }

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

.p-head { display: flex; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
.p-head-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }

.p-head h1 {
  font-family: var(--font-title);
  font-weight: 700;
  font-size: 28px;
  letter-spacing: -0.015em;
  margin: 0;
  line-height: 1.1;
}

.p-sub { margin: 0; color: var(--muted); font-size: 14px; }
.p-head-actions { margin-left: auto; display: flex; gap: 8px; align-items: center; }

.p-error {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 14px;
  font-weight: 500;
}

@media (max-width: 1023px) {
  .p-head h1 { font-size: 24px; }
  .p-head-actions { margin-left: 0; width: 100%; }
}
</style>
