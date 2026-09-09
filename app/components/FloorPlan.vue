<script setup lang="ts">
/**
 * The room, from above — drawn from the `tables` rows, never hard-coded.
 *
 * Each table carries a `col` and a `row`, which are its place on the zone's
 * schematic rather than a position in a list. So the two zones read those two
 * numbers in opposite directions:
 *
 *   unutra  one vertical stack per `col` (the three runs of tables along the
 *           walls), ordered by `row`
 *   bašta   one horizontal line per `row` (the rows of tables on the terrace),
 *           ordered by `col`
 *
 * Tables with a `grp` (today only the VIP pair) are drawn in their own dashed
 * box under the column they belong to, because their coordinates are relative
 * to that box and would otherwise collide with the main grid.
 *
 * Add a table to the database with the right col/row and it appears here; this
 * file never learns how many tables the café has.
 *
 * **What WP9 changed.** The tile used to guess whose table it was by comparing
 * `opened_by_name` to the name in localStorage. It now reads `assigned_to`
 * against the session's user id, which is a different question and the right
 * one: a table handed over mid-shift belongs to whoever holds it now, not to
 * whoever opened it. The initials come down the wire too
 * (`assigned_to_initials`), so the plan no longer needs the staff list to draw a
 * colleague's badge, and the amount on a tile is `remaining_fen` — what is still
 * owed — rather than the full total of a tab already half paid.
 */
import { formatAmount } from '#shared/money'
import type { TableState, VenueTable, Zone } from '#shared/types'

const props = withDefaults(defineProps<{
  tables: VenueTable[]
  zone: Zone
  states: TableState[]
  /** The person holding the phone, from `GET /api/me`. */
  myUserId: string | null
  /** Tables with an unlocked draft on this phone — drawn dashed (S1). */
  draftTables?: string[]
  /** "nacrt 3 · 8,50" for one of those tables. */
  draftLabel?: (tableId: string) => string
}>(), {
  draftTables: () => [],
  draftLabel: undefined,
})

defineEmits<{ select: [tableId: string], long: [tableId: string] }>()

interface Cell {
  id: string
  label: string
  sub: string | null
  variant: 'free' | 'mine' | 'other' | 'offered'
  attention: boolean
  late: boolean
  /** A round on this table has not left the phone yet. */
  draft: boolean
}

const stateById = computed(() => new Map(props.states.map(s => [s.table_id, s])))

/** "Sto 7" → "7": every circle would otherwise say the same word. */
function shortLabel(name: string): string {
  return name.replace(/^sto\s+/i, '')
}

function toCell(table: VenueTable): Cell {
  const state = stateById.value.get(table.id)
  const label = shortLabel(table.name)
  const draft = props.draftTables.includes(table.id)
  const base = { id: table.id, label, attention: false, late: false, draft }

  if (!state?.tab_id) {
    // A table with nothing on the server but a draft on this phone is not free:
    // it is drawn dashed with what the draft comes to, so a colleague does not
    // seat guests at it and so the waiter can find his own unlocked round.
    return draft
      ? { ...base, sub: props.draftLabel?.(table.id) ?? 'nacrt', variant: 'mine' }
      : { ...base, sub: null, variant: 'free' }
  }

  const common = {
    ...base,
    attention: state.pending_review,
    late: state.late_sync,
  }

  // Offered to me and not taken yet: not mine, but one tap from it.
  if (state.offered_to && state.offered_to === props.myUserId) {
    return { ...common, sub: 'nudi', variant: 'offered' }
  }

  if (state.assigned_to && state.assigned_to === props.myUserId) {
    // The amount without " KM": at 10 px the currency is noise, not information.
    return { ...common, sub: formatAmount(state.remaining_fen), variant: 'mine' }
  }

  return { ...common, sub: state.assigned_to_initials, variant: 'other' }
}

const zoneTables = computed(() => props.tables.filter(t => t.zone === props.zone))

/** Unutra: the vertical stacks, plus whatever boxed groups hang off each one. */
const columns = computed(() => {
  const cols = [...new Set(zoneTables.value.map(t => t.col))].sort((a, b) => a - b)
  return cols.map((col) => {
    const inColumn = zoneTables.value.filter(t => t.col === col)
    const groupNames = [...new Set(inColumn.filter(t => t.grp).map(t => t.grp!))]
    return {
      col,
      cells: inColumn.filter(t => !t.grp).sort((a, b) => a.row - b.row).map(toCell),
      groups: groupNames.map(name => ({
        name,
        cells: inColumn.filter(t => t.grp === name).sort((a, b) => a.row - b.row).map(toCell),
      })),
    }
  })
})

/** Bašta: the horizontal lines. Seven in a row means smaller circles. */
const rows = computed(() => {
  const rowNumbers = [...new Set(zoneTables.value.map(t => t.row))].sort((a, b) => a - b)
  return rowNumbers.map((row) => {
    const inRow = zoneTables.value.filter(t => t.row === row).sort((a, b) => a.col - b.col)
    return { row, small: inRow.length >= 7, cells: inRow.map(toCell) }
  })
})
</script>

<template>
  <!-- px-2: the long bašta row is seven 46 px circles wide and needs the width. -->
  <div class="flex flex-1 flex-col gap-3 rounded-2xl border border-line bg-bg px-2 py-4">
    <div class="flex flex-1 overflow-x-auto">
      <!-- Unutra: columns down the walls -->
      <div v-if="zone === 'unutra'" class="flex flex-1 items-center justify-between gap-2">
        <div
          v-for="column in columns"
          :key="column.col"
          class="flex flex-col items-center gap-3.5"
        >
          <FloorTable
            v-for="cell in column.cells"
            :key="cell.id"
            :label="cell.label"
            :sub="cell.sub"
            :variant="cell.variant"
            :attention="cell.attention"
            :late="cell.late"
            :draft="cell.draft"
            @select="$emit('select', cell.id)"
            @long="$emit('long', cell.id)"
          />
          <div
            v-for="group in column.groups"
            :key="group.name"
            class="flex flex-col items-center gap-2 rounded-xl border-[1.5px] border-dashed border-muted px-3 pb-3 pt-2"
          >
            <span class="text-xs font-bold tracking-[0.1em] text-text-2">{{ group.name.toUpperCase() }}</span>
            <div class="flex gap-3">
              <FloorTable
                v-for="cell in group.cells"
                :key="cell.id"
                :label="cell.label"
                :sub="cell.sub"
                :variant="cell.variant"
                :attention="cell.attention"
                :late="cell.late"
                :draft="cell.draft"
                @select="$emit('select', cell.id)"
                @long="$emit('long', cell.id)"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Bašta: lines across the terrace -->
      <div v-else class="flex flex-1 flex-col items-center justify-evenly gap-8 py-3">
        <div
          v-for="line in rows"
          :key="line.row"
          class="mx-auto flex w-max items-center"
          :class="line.small ? 'gap-0.5' : 'gap-6'"
        >
          <FloorTable
            v-for="cell in line.cells"
            :key="cell.id"
            :label="cell.label"
            :sub="cell.sub"
            :variant="cell.variant"
            :attention="cell.attention"
            :late="cell.late"
            :draft="cell.draft"
            :small="line.small"
            @select="$emit('select', cell.id)"
            @long="$emit('long', cell.id)"
          />
        </div>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-center gap-x-3.5 gap-y-1 text-[13px] text-text-2">
      <span class="flex items-center gap-1.5"><i class="inline-block size-3 rounded-full bg-accent" />moj sto</span>
      <span class="flex items-center gap-1.5"><i class="inline-block size-3 rounded-full bg-line" />kolegin</span>
      <span class="flex items-center gap-1.5"><i class="inline-block size-3 rounded-full border border-muted" />slobodan</span>
      <span class="flex items-center gap-1.5"><i class="inline-block size-3 rounded-full border border-dashed border-accent" />nacrt</span>
      <span class="flex items-center gap-1.5"><i class="inline-block size-3 rounded-full border-2 border-warn" />čeka</span>
    </div>
  </div>
</template>
