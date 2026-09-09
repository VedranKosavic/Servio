<script setup lang="ts">
/**
 * The floor plan as the waiter sees it, drawn live from the numbers being typed
 * beside it.
 *
 * `col` and `row` are a bird's-eye schematic of the room, not a sort order: the
 * waiter taps the table that is physically where he is standing. So the only
 * honest way to edit them is to see the result, which is what this is — a CSS
 * grid where each table sits at its own `grid-column` / `grid-row`. Two tables
 * on the same square is the mistake this makes visible immediately.
 *
 * No drag-and-drop in Phase 2: the numbers are typed, and this is the preview.
 */
import type { TableAdmin, Zone } from '#shared/types'

const props = defineProps<{
  tables: TableAdmin[]
  zone: Zone
  /** The row highlighted because its number field is focused. */
  activeId?: string | null
}>()

const emit = defineEmits<{ pick: [id: string] }>()

const mine = computed(() => props.tables.filter(table => table.zone === props.zone))

/** Draw as many rows as are used, never fewer than four, never more than 12. */
const rows = computed(() => {
  const used = mine.value.reduce((max, table) => Math.max(max, table.row), 0)
  return Math.min(12, Math.max(4, used))
})

const cols = computed(() => {
  const used = mine.value.reduce((max, table) => Math.max(max, table.col), 0)
  return Math.min(12, Math.max(4, used))
})

/** More than one table on the same square — visible, and worth saying out loud. */
const clashes = computed(() => {
  const seen = new Map<string, number>()
  for (const table of mine.value) {
    const key = `${table.col}:${table.row}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([key]) => key))
})

function toneOf(table: TableAdmin): string {
  // The clash wins: two tables on one square hides one of them behind the
  // other, and that is the thing worth seeing first.
  if (clashes.value.has(`${table.col}:${table.row}`)) return 'clash'
  if (!table.active) return 'off'
  if (table.has_open_tab) return 'busy'
  return ''
}
</script>

<template>
  <div class="p-plan-wrap">
    <div
      class="p-plan"
      :style="{
        gridTemplateColumns: `repeat(${cols}, minmax(64px, 1fr))`,
        gridTemplateRows: `repeat(${rows}, 52px)`,
      }"
    >
      <button
        v-for="table in mine"
        :key="table.id"
        type="button"
        class="p-cell"
        :class="[toneOf(table), { on: activeId === table.id }]"
        :style="{ gridColumn: table.col, gridRow: table.row }"
        @click="emit('pick', table.id)"
      >
        <b>{{ table.name }}</b>
        <small v-if="clashes.has(`${table.col}:${table.row}`)">poklapanje</small>
        <small v-else-if="!table.active">ugašen</small>
        <small v-else-if="table.has_open_tab">zauzet</small>
        <small v-else-if="table.grp">{{ table.grp }}</small>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* The plan scrolls inside its own box on a phone; the page body never does. */
.p-plan-wrap { overflow-x: auto; min-width: 0; -webkit-overflow-scrolling: touch; }

.p-plan { display: grid; gap: 6px; min-width: 300px; }

.p-cell {
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 1px;
  padding: 0 8px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  min-width: 0;
  overflow: hidden;
}

.p-cell b { font-size: 14px; font-weight: 600; }
.p-cell small { font-size: 11px; color: var(--muted); }

.p-cell.busy { background: var(--warn-soft); border-color: var(--warn); }
.p-cell.busy small { color: var(--warn); }
.p-cell.off { border-style: dashed; opacity: 0.6; }
.p-cell.clash { background: var(--danger-soft); border-color: var(--danger); }
.p-cell.clash small { color: var(--danger); }
.p-cell.on { outline: 2px solid var(--accent); outline-offset: 1px; }
</style>
