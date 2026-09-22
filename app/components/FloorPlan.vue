<script setup lang="ts">
/**
 * The room, from above — drawn from the `tables` rows, never hard-coded.
 *
 * **Since the room was arranged (`shared/floor.ts`)** the stacks below are only
 * where a table stands until the owner drags it somewhere on *Stolovi* and
 * saves: from then on every table is exactly where he put it, the bar included,
 * and `FloorRoom` draws the floor, the walls and the counter around the tiles
 * this file still decides the colour of. What follows describes the
 * rule `autoLayout()` keeps for a room nobody has arranged yet.
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
import { roomPlan } from '#shared/floor'
import type { FloorLayout } from '#shared/floor'
import type { TableState, VenueTable, Zone } from '#shared/types'

const props = withDefaults(defineProps<{
  tables: VenueTable[]
  /** Where the owner put every table and the bar — `bootstrap.floor`. */
  floor?: FloorLayout
  zone: Zone
  states: TableState[]
  /** The person holding the phone, from `GET /api/me`. */
  myUserId: string | null
  /** Tables with an unlocked draft on this phone — drawn dashed (S1). */
  draftTables?: string[]
  /** "nacrt 3 · 8,50" for one of those tables. */
  draftLabel?: (tableId: string) => string
  /**
   * Which shift of the business day is running — 1 the morning, 2 the evening.
   * The colour a *draft* wears, since a round nobody has locked yet has no
   * shift of its own.
   */
  currentShiftSeq?: number | null
}>(), {
  floor: () => ({ tables: {} }),
  draftTables: () => [],
  draftLabel: undefined,
  currentShiftSeq: null,
})

defineEmits<{ select: [tableId: string], long: [tableId: string], bar: [] }>()

interface Cell {
  id: string
  label: string
  sub: string | null
  variant: 'free' | 'shift-a' | 'shift-b' | 'offered'
  /** Settled and still occupied: the checkmark. */
  paid: boolean
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
  const base = { id: table.id, label, paid: false, attention: false, late: false, draft }

  if (!state?.tab_id) {
    // A table with nothing on the server but a draft on this phone is not free:
    // it is drawn dashed with what the draft comes to, so a colleague does not
    // seat guests at it and so the waiter can find his own unlocked round.
    return draft
      ? { ...base, sub: props.draftLabel?.(table.id) ?? 'nacrt', variant: shiftVariant(null) }
      : { ...base, sub: null, variant: 'free' }
  }

  const common = {
    ...base,
    paid: state.paid,
    attention: state.pending_review,
    late: state.late_sync,
  }

  // Offered to me and not taken yet: not mine, but one tap from it.
  if (state.offered_to && state.offered_to === props.myUserId) {
    return { ...common, sub: 'nudi', variant: 'offered' }
  }

  /**
   * The colour is the **shift**, not the person. Whose table it is moved to the
   * second line: my own tables show what is still owed on them, a colleague's
   * his initials — which is where that badge already was.
   */
  const variant = shiftVariant(state.shift_seq)
  const mine = state.assigned_to === props.myUserId

  if (mine) {
    // The amount without " KM": the currency on every tile is noise, and the
    // tile now has the width to set the number itself at a readable size.
    return { ...common, sub: formatAmount(state.remaining_fen), variant }
  }

  return { ...common, sub: state.assigned_to_initials, variant }
}

/**
 * Which shift's colour a tile wears.
 *
 * `shift_seq` is the tab's shift ranked within its own business day — 1 the
 * morning, 2 the evening — and a café that grows a third shift alternates from
 * there rather than needing a third hue nobody could name. A draft that has not
 * been locked yet has no shift of its own, so it wears the shift the phone is
 * working now, which for the person looking at it is the truthful answer.
 */
function shiftVariant(seq: number | null): 'shift-a' | 'shift-b' {
  const n = seq ?? props.currentShiftSeq ?? 1
  return n % 2 === 0 ? 'shift-b' : 'shift-a'
}

/** This zone, arranged: every table at its spot, the bar if it stands here. */
const plan = computed(() => roomPlan(props.tables, props.floor, props.zone))

/** Each tile's colour and second line, by table id. */
const cells = computed(() => new Map(props.tables
  .filter(t => t.zone === props.zone)
  .map(t => [t.id, toCell(t)])))
</script>

<template>
  <div class="flex flex-1 flex-col gap-3">
    <FloorRoom class="mx-auto max-w-[560px]" :plan="plan" @bar="$emit('bar')">
      <template #table="{ table }">
        <FloorTable
          v-if="cells.get(table.id)"
          :label="cells.get(table.id)!.label"
          :sub="cells.get(table.id)!.sub"
          :variant="cells.get(table.id)!.variant"
          :paid="cells.get(table.id)!.paid"
          :attention="cells.get(table.id)!.attention"
          :late="cells.get(table.id)!.late"
          :draft="cells.get(table.id)!.draft"
          :shape="table.shape"
          @select="$emit('select', table.id)"
          @long="$emit('long', table.id)"
        />
      </template>
    </FloorRoom>

    <!-- The caption on the plan: colour never carries a meaning on its own, so
         every marker is drawn beside the word it stands for. -->
    <ul class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 px-2 text-caption tracking-normal text-muted">
      <li class="flex items-center gap-1.5"><i class="key key-shift-a" />prva smjena</li>
      <li class="flex items-center gap-1.5"><i class="key key-shift-b" />druga smjena</li>
      <li class="flex items-center gap-1.5"><i class="key key-paid" />naplaćen</li>
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
  border: 1.5px solid var(--line);
  background: var(--surface-2);
}

.key-shift-a { background: var(--accent); border-color: transparent; }
.key-shift-b { background: var(--shift-b); border-color: transparent; }
/* Settled: the same dimming the tile itself takes. */
.key-paid { background: var(--accent); border-color: transparent; opacity: 0.62; }
.key-draft { background: transparent; border-color: var(--accent-line); border-style: dashed; }
.key-wait { background: transparent; border-color: var(--warn); }
</style>
