<script setup lang="ts">
/**
 * The container everything on `/admin` sits in: `--surface`, a 1 px `--line`,
 * `--radius-card`, and one hairline of contact shadow — enough that the card
 * sits *on* the paper rather than being a rectangle drawn on it, and not a
 * pixel more. A rule alone is what makes a light dashboard look like a
 * spreadsheet; a real drop shadow is what makes it look like 2014.
 *
 * The head is the second step of the page's hierarchy: the page title is 24 px
 * display, a card heading is 16 px semibold, a row inside it is 15 px. `count`
 * is the quiet number beside the heading ("Zahtijeva pažnju · 3") and it is
 * tabular, because it changes while somebody is looking at it.
 *
 * `flush` takes the padding off the body so a table can reach the card's own
 * edges — a dense table inset by 16 px on both sides wastes the two columns it
 * needed. The head keeps its padding either way.
 */
withDefaults(defineProps<{
  title?: string
  /** Rendered in `--muted` after the title. A string, so "3 stavke" works too. */
  count?: string | number
  /** Body padding off, for a table that should reach the card's edges. */
  flush?: boolean
  /** No border, no shadow — a card used as a plain grouping inside a column. */
  quiet?: boolean
}>(), { flush: false, quiet: false })
</script>

<template>
  <section class="a-card" :class="{ flush, quiet }">
    <header v-if="title || $slots.title || $slots.actions" class="a-card-head">
      <h2 v-if="title || $slots.title">
        <slot name="title">{{ title }}</slot>
        <span v-if="count !== undefined" class="a-card-count">{{ count }}</span>
      </h2>
      <div v-if="$slots.actions" class="a-card-actions"><slot name="actions" /></div>
    </header>

    <div class="a-card-body"><slot /></div>
  </section>
</template>

<style scoped>
.a-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  padding: 16px 20px 20px;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.a-card.quiet { border-color: transparent; box-shadow: none; background: transparent; padding: 0; }

.a-card-head {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 28px;
  margin-bottom: 14px;
}

.a-card-head h2 {
  font-size: var(--text-section);
  line-height: 1.35;
  letter-spacing: -0.005em;
  font-weight: 600;
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.a-card-count {
  font-size: var(--text-label);
  color: var(--muted);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.a-card-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
  align-items: center;
}

.a-card-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

/* A table reaches the card's own edges. The head keeps its padding, so the
   heading still lines up with the page's other headings. */
.a-card.flush { padding: 16px 0 8px; }
.a-card.flush .a-card-head { padding: 0 20px; }
.a-card.flush .a-card-body { gap: 0; }
.a-card.flush :deep(.a-table th:first-child),
.a-card.flush :deep(.a-table td:first-child) { padding-left: 20px; }
.a-card.flush :deep(.a-table th:last-child),
.a-card.flush :deep(.a-table td:last-child) { padding-right: 20px; }

@media (max-width: 1023px) {
  .a-card { padding: 14px 16px 16px; }
  .a-card.flush { padding: 14px 0 6px; }
  .a-card.flush .a-card-head { padding: 0 16px; }
  .a-card.flush :deep(.a-table th:first-child),
  .a-card.flush :deep(.a-table td:first-child) { padding-left: 16px; }
  .a-card.flush :deep(.a-table th:last-child),
  .a-card.flush :deep(.a-table td:last-child) { padding-right: 16px; }
}
</style>
