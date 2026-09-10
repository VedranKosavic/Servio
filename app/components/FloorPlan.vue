<script setup lang="ts">
/**
 * The room, from above — drawn from the `tables` rows, never hard-coded.
 *
 * Each table carries a `col` and a `row`, which are its place on the zone's
 * schematic rather than a position in a list, and both zones read them the same
 * way: one vertical stack per `col`, ordered by `row`, the stacks spread across
 * the width in `col` order.
 *
 *   unutra  the three runs of tables along the walls (6 · 4 · 5)
 *   bašta   the owner's 2026-09-10 sketch: a left column of seven and a right
 *           column of three
 *
 * A stack shorter than the tallest one is centred against it — `items-center`
 * on the row of stacks — so bašta's three sit level with the middle of the
 * seven, which is what the sketch shows.
 *
 * Tables with a `grp` (today only the VIP pair) are drawn in their own dashed
 * box under the column they belong to, because their coordinates are relative
 * to that box and would otherwise collide with the main grid.
 *
 * Add a table to the database with the right col/row and it appears here; this
 * file never learns how many tables the café has.
 *
 * **The material.** The plan is an inset well — the room is a space the tiles
 * sit *in*, not a list of cards — and the surface ladder does the rest: a free
 * table is one step above the well, a colleague's one step above that, and
 * mine is the only copper on the screen. The legend is the foot of the same
 * well, behind a hairline, so it reads as a caption on the plan rather than as
 * a fifth row of controls.
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
    // The amount without " KM": the currency on every tile is noise, and the
    // tile now has the width to set the number itself at a readable size.
    return { ...common, sub: formatAmount(state.remaining_fen), variant: 'mine' }
  }

  return { ...common, sub: state.assigned_to_initials, variant: 'other' }
}

const zoneTables = computed(() => props.tables.filter(t => t.zone === props.zone))

/** The vertical stacks, plus whatever boxed groups hang off each one. */
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
</script>

<template>
  <div class="well flex flex-1 flex-col gap-4 rounded-panel px-3 py-4">
    <div class="flex flex-1 overflow-x-auto">
      <!-- Both zones: one stack per column, shorter stacks centred (items-center). -->
      <div class="flex flex-1 items-center justify-between gap-2">
        <div
          v-for="column in columns"
          :key="column.col"
          class="flex flex-col items-center gap-3"
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
            class="flex flex-col items-center gap-2 rounded-card border border-dashed border-line px-3 pb-3 pt-2"
          >
            <span class="eyebrow">{{ group.name }}</span>
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
    </div>

    <!-- The caption on the plan: colour never carries a meaning on its own, so
         every marker is drawn beside the word it stands for. -->
    <ul class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border-t border-line-soft pt-3 text-caption tracking-normal text-muted">
      <li class="flex items-center gap-1.5"><i class="key key-mine" />moj sto</li>
      <li class="flex items-center gap-1.5"><i class="key key-other" />kolegin</li>
      <li class="flex items-center gap-1.5"><i class="key key-free" />slobodan</li>
      <li class="flex items-center gap-1.5"><i class="key key-draft" />nacrt</li>
      <li class="flex items-center gap-1.5"><i class="key key-wait" />čeka</li>
    </ul>
  </div>
</template>

<style scoped>
/* The legend markers are the tiles in miniature — same fills, same borders, so
   the key and the plan cannot drift apart. */
.key {
  display: inline-block;
  width: 11px;
  height: 11px;
  flex-shrink: 0;
  border-radius: 4px;
  border: 1.5px solid var(--line-soft);
  background: var(--surface);
}

.key-mine { background: var(--accent); border-color: transparent; }
.key-other { background: var(--surface-2); border-color: var(--line); }
.key-draft { background: transparent; border-color: var(--accent-line); border-style: dashed; }
.key-wait { background: transparent; border-color: var(--warn); }
</style>
