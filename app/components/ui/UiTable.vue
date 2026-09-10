<script setup lang="ts">
/**
 * The dense table `/admin` is mostly made of.
 *
 * Four things it takes care of so no page has to:
 *
 * - **The wrapper scrolls, the page does not.** A wide table on a 390 px phone
 *   scrolls inside its own box; the body never scrolls sideways.
 * - **The header sticks** while the rows move under it, and it is a 12 px
 *   letterspaced caps line in `--muted` — a column header is a label, not a row.
 * - **`align: 'r'` right-aligns a column**, which is where every amount goes.
 * - **Every cell is tabular**, so a column of amounts lines up on the comma.
 *
 * Rows are a slot, not a prop: every page's row is different, and a "column
 * renderer" abstraction would be a worse version of `<template #row>`.
 *
 * The rules between rows are `--line-soft` and the rule under the header is
 * `--line`. That is the whole reason there are two border tokens: boxing every
 * row in the same line an edge is drawn with is what makes a table read as a
 * spreadsheet instead of as a list.
 */
export interface UiColumn {
  key: string
  label: string
  /** `'r'` right-aligns the cells and the header. Amounts, counts, times. */
  align?: 'l' | 'r'
  /** A fixed column width, e.g. `'52px'`. */
  width?: string
}

withDefaults(defineProps<{
  columns: UiColumn[]
  /** Rendered in place of the rows when there is nothing to show. Bosnian. */
  empty?: string
  /** Draws three skeleton rows instead of a spinner over stale numbers. */
  loading?: boolean
  /** A row lights up under the pointer. On when the whole row is a link. */
  hover?: boolean
}>(), { hover: false })
</script>

<template>
  <div class="a-table-wrap">
    <table class="a-table" :class="{ hoverable: hover }">
      <thead>
        <tr>
          <th
            v-for="column in columns"
            :key="column.key"
            :class="{ r: column.align === 'r' }"
            :style="column.width ? { width: column.width } : undefined"
          >{{ column.label }}</th>
        </tr>
      </thead>
      <tbody v-if="loading">
        <tr v-for="n in 3" :key="n" class="skeleton">
          <td v-for="column in columns" :key="column.key"><span class="bar" /></td>
        </tr>
      </tbody>
      <tbody v-else>
        <slot />
      </tbody>
    </table>
    <p v-if="!loading && empty && !$slots.default" class="a-table-empty">{{ empty }}</p>
  </div>
</template>

<style scoped>
.a-table-wrap {
  /* The table scrolls inside this box; the page body never scrolls sideways. */
  overflow-x: auto;
  min-width: 0;
  -webkit-overflow-scrolling: touch;
}

.a-table {
  border-collapse: collapse;
  width: 100%;
  font-size: var(--text-label);
}

.a-table th {
  font-size: var(--text-caption);
  line-height: 1.3;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--muted);
  font-weight: 600;
  text-align: left;
  padding: 0 10px 8px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
  position: sticky;
  top: 0;
  background: var(--surface);
  z-index: 1;
}

.a-table :deep(td) {
  padding: 10px;
  border-bottom: 1px solid var(--line-soft);
  vertical-align: middle;
  /* Tabular figures: every digit the same width, so a column of amounts
     lines up on the comma instead of shuffling as the numbers change. */
  font-variant-numeric: tabular-nums;
}

.a-table :deep(tbody tr:last-child td) { border-bottom: 0; }
.a-table th.r, .a-table :deep(td.r) { text-align: right; }

/* The first cell is the row's name; it carries the weight so the eye can run
   down the left edge without reading the whole row. */
.a-table :deep(tbody td:first-child) { color: var(--ink); font-weight: 500; }

.a-table.hoverable :deep(tbody tr) {
  transition: background var(--dur-fast) var(--ease-standard);
}

.a-table.hoverable :deep(tbody tr:hover) { background: var(--surface-3); }

.a-table-empty {
  margin: 12px 2px 2px;
  color: var(--muted);
  font-size: var(--text-label);
}

.skeleton .bar {
  display: block;
  height: 10px;
  border-radius: var(--radius-chip);
  background: var(--surface-2);
}

@media (max-width: 1023px) {
  .a-table { font-size: var(--text-body); }
  /* 44 px of row without a fixed height, so a two-line cell still fits. */
  .a-table :deep(td) { padding: 13px 10px; }
}
</style>
