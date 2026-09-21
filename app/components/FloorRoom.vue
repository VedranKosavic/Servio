<script setup lang="ts">
/**
 * One zone of the café, drawn as a room: a floor, walls, the bar with its
 * stools, and every table standing where the owner put it with its chairs
 * around it.
 *
 * **Why a room and not a grid.** The owner's words about the plan it replaces:
 * *"I want this to look more like a caffe, not just a bad sketch."* A column of
 * numbered squares is a list with extra steps; chairs, a counter and a floor are
 * what make a waiter see the room he is standing in, and find table 12 by where
 * it is rather than by reading every number.
 *
 * **Where things stand** comes from `roomPlan()` (`shared/floor.ts`), in room
 * units: the room is `plan.width` units wide and always fills this component,
 * so a unit is `100cqw / plan.width` — `--u`, which every size in here and in
 * the tiles is a multiple of. The same arrangement is therefore the same
 * picture at every width, and nothing here measures anything to draw it.
 *
 * **What it does not draw is the table top.** Each table is a slot, filled by
 * the screen using the room: the waiter's tile (dark, the shift colours, the
 * long press for žar), *Puls*'s (light), or the editor's plain number. The room
 * draws the chairs, because the chairs are the room's — a table's `tone` only
 * decides whether they are the colour of the guests sitting in them.
 *
 * **Editable**, on *Stolovi*: a table or the bar is dragged with a finger or a
 * mouse (pointer capture, so a drag that leaves the room still ends), snapped
 * to whole units and kept clear of the walls; the arrow keys nudge the selected
 * one. The room only reports where things were dropped — keeping the working
 * copy, and saving it, is the editor's job.
 */
import { BAR_DEPTH, CHAIR_DEPTH, CHAIR_GAP, STOOL_OUT, clampBar, clampTable } from '#shared/floor'
import type { PlacedBar, PlacedTable, RoomPlan } from '#shared/floor'

/** What sits at a table, for the colour of its chairs. */
export type ChairTone = 'free' | 'a' | 'b' | 'busy' | 'offered'

const props = withDefaults(defineProps<{
  plan: RoomPlan
  tone?: (id: string) => ChairTone
  editable?: boolean
  /** A table id, `'bar'`, or nothing. */
  selected?: string | null
  /** Items standing on one another — marked red in the editor. */
  clashes?: Set<string>
}>(), {
  tone: () => 'free',
  editable: false,
  selected: null,
  clashes: () => new Set<string>(),
})

const emit = defineEmits<{
  /** A table (by id) or the bar (`'bar'`) was dragged to x, y. */
  move: [id: string, x: number, y: number]
  select: [id: string | null]
}>()

const room = ref<HTMLElement | null>(null)

/** Room units → CSS: the room is `plan.width` units across this component. */
function u(n: number): string {
  return `${(n * 100) / props.plan.width}cqw`
}

function box(item: { x: number, y: number, w: number, h: number }) {
  return { left: u(item.x), top: u(item.y), width: u(item.w), height: u(item.h) }
}

/**
 * The chairs around a table top, relative to it: one on each side of a square
 * or round table, two along each long side of a wide one — `CHAIR_OUT` in
 * `shared/floor.ts` is how far they reach.
 */
function chairs(t: PlacedTable) {
  const d = CHAIR_DEPTH
  const off = CHAIR_GAP
  const len = 8
  const along = t.shape === 'wide' ? [3.5, t.w - 3.5 - len] : [(t.w - len) / 2]
  const across = (t.h - len) / 2
  return [
    ...along.map(x => ({ key: `t${x}`, left: x, top: -(d + off), w: len, h: d })),
    ...along.map(x => ({ key: `b${x}`, left: x, top: t.h + off, w: len, h: d })),
    { key: 'l', left: -(d + off), top: across, w: d, h: len },
    { key: 'r', left: t.w + off, top: across, w: d, h: len },
  ]
}

/** The stools along the bar's guest side, one every 7 units. */
function stools(bar: PlacedBar) {
  const size = 3.8
  const count = Math.max(2, Math.floor(bar.len / 8))
  const step = bar.len / count
  return Array.from({ length: count }, (_, i) => {
    const along = step * i + (step - size) / 2
    const out = -(STOOL_OUT)
    switch (bar.rot) {
      case 0: return { key: i, left: along, top: BAR_DEPTH + STOOL_OUT - size, size }
      case 180: return { key: i, left: along, top: out, size }
      case 90: return { key: i, left: out, top: along, size }
      default: return { key: i, left: BAR_DEPTH + STOOL_OUT - size, top: along, size }
    }
  })
}

const vertical = computed(() => props.plan.bar?.rot === 90 || props.plan.bar?.rot === 270)

/** The editor's room has slack under the last table, to drag things into. */
const height = computed(() => props.plan.height + (props.editable ? 24 : 0))

// ---------------------------------------------------------------------------
// Dragging — only on Stolovi
// ---------------------------------------------------------------------------

interface Drag {
  id: string
  pointer: number
  startX: number
  startY: number
  fromX: number
  fromY: number
  w: number
}

let drag: Drag | null = null

function unitPx(): number {
  return (room.value?.getBoundingClientRect().width ?? props.plan.width) / props.plan.width
}

function place(id: string, x: number, y: number, w: number) {
  const width = props.plan.width
  const at = id === 'bar' ? clampBar(x, y, w, width) : clampTable(x, y, w, width)
  emit('move', id, at.x, Math.min(at.y, 360))
}

function onDown(event: PointerEvent, id: string, item: { x: number, y: number, w: number }) {
  if (!props.editable || event.button > 0) return
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  target.focus({ preventScroll: true })
  drag = {
    id,
    pointer: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    fromX: item.x,
    fromY: item.y,
    w: item.w,
  }
  emit('select', id)
}

function onMove(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointer) return
  const unit = unitPx()
  place(
    drag.id,
    drag.fromX + (event.clientX - drag.startX) / unit,
    drag.fromY + (event.clientY - drag.startY) / unit,
    drag.w,
  )
}

function onUp(event: PointerEvent) {
  if (drag && event.pointerId === drag.pointer) drag = null
}

/** The arrow keys, for a mouse that overshoots and for anyone without one. */
function onKey(event: KeyboardEvent, id: string, item: { x: number, y: number, w: number }) {
  if (!props.editable) return
  const step = event.shiftKey ? 5 : 1
  const delta: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  }
  const d = delta[event.key]
  if (!d) return
  event.preventDefault()
  emit('select', id)
  place(id, item.x + d[0], item.y + d[1], item.w)
}

function onRoomDown(event: PointerEvent) {
  if (props.editable && event.target === event.currentTarget) emit('select', null)
}
</script>

<template>
  <div class="fr">
    <div
      ref="room"
      class="fr-room"
      :class="[plan.zone, { editable }]"
      :style="{ height: u(height), '--u': u(1) }"
      @pointerdown="onRoomDown"
    >
      <!-- The VIP box and anything like it: under the tables, a patch of
           floor with its name on it. -->
      <div
        v-for="group in plan.groups"
        :key="group.name"
        class="fr-grp"
        :style="box(group)"
        aria-hidden="true"
      >
        <span class="fr-grp-name">{{ group.name }}</span>
      </div>

      <!-- The bar: a counter, the stools on the guests' side, and its name. -->
      <div
        v-if="plan.bar"
        class="fr-bar"
        :class="[`rot-${plan.bar.rot}`, {
          selected: editable && selected === 'bar',
          clash: editable && clashes.has('bar'),
        }]"
        :style="box(plan.bar)"
        :tabindex="editable ? 0 : undefined"
        :role="editable ? 'button' : undefined"
        :aria-label="editable ? 'Šank' : undefined"
        :aria-hidden="editable ? undefined : 'true'"
        @pointerdown="onDown($event, 'bar', plan.bar)"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
        @keydown="onKey($event, 'bar', plan.bar)"
      >
        <i
          v-for="stool in stools(plan.bar)"
          :key="stool.key"
          class="fr-stool"
          :style="{ left: u(stool.left), top: u(stool.top), width: u(stool.size), height: u(stool.size) }"
        />
        <span class="fr-bar-top" :class="{ vertical }">
          <svg
            class="fr-bar-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
          ><path d="M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" /><path d="M17 9h2a2.5 2.5 0 0 1 0 5h-2" /><path d="M5 21h12" /></svg>
          Šank
        </span>
      </div>

      <!-- The tables, each with its chairs, the top drawn by whoever uses the room. -->
      <div
        v-for="table in plan.tables"
        :key="table.id"
        class="fr-table"
        :class="[`tone-${tone(table.id)}`, table.shape, {
          selected: editable && selected === table.id,
          clash: editable && clashes.has(table.id),
          loose: editable && table.loose,
        }]"
        :style="box(table)"
        :tabindex="editable ? 0 : undefined"
        @pointerdown="onDown($event, table.id, table)"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
        @keydown="onKey($event, table.id, table)"
      >
        <i
          v-for="chair in chairs(table)"
          :key="chair.key"
          class="fr-chair"
          :style="{ left: u(chair.left), top: u(chair.top), width: u(chair.w), height: u(chair.h) }"
          aria-hidden="true"
        />
        <div class="fr-top">
          <slot name="table" :table="table" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The container `--u` is measured against: everything inside is a multiple of
   it (see `u()`). */
.fr {
  container-type: inline-size;
  width: 100%;
}

/**
 * The floor and the walls.
 *
 * The walls are an inset shadow, not a border, so they take no width: 100 units
 * is the whole room, and a table's coordinates never depend on how thick the
 * wall happens to be drawn.
 */
.fr-room {
  position: relative;
  width: 100%;
  border-radius: var(--radius-panel);
  overflow: hidden;
  -webkit-user-select: none;
  user-select: none;
}

/**
 * Inside: boards. Warm, a step off the page's own ground, with the joints
 * running away from the viewer and a second, fainter line where the planks end —
 * a floor, drawn in the two hairline tokens and nothing else.
 */
.fr-room.unutra {
  background-color: color-mix(in oklab, var(--accent) 7%, var(--bg-2));
  background-image:
    repeating-linear-gradient(
      90deg,
      transparent 0 calc(calc(var(--u) * 8.4) - 1px),
      color-mix(in oklab, var(--line-soft) 70%, transparent) calc(calc(var(--u) * 8.4) - 1px) calc(var(--u) * 8.4)
    ),
    repeating-linear-gradient(
      90deg,
      color-mix(in oklab, var(--accent) 3%, transparent) 0 calc(var(--u) * 4.2),
      transparent calc(var(--u) * 4.2) calc(var(--u) * 8.4)
    );
  box-shadow:
    inset 0 0 0 4px var(--surface-3),
    inset 0 0 0 5px var(--line),
    inset 0 0 calc(var(--u) * 3) calc(var(--u) * 1) var(--scrim);
}

/**
 * The garden: paving under the open sky, a cooler ground, and a low fence
 * instead of a wall — dashed, because you can see over it.
 */
.fr-room.basta {
  background-color: color-mix(in oklab, var(--good) 7%, var(--bg-2));
  background-image:
    linear-gradient(color-mix(in oklab, var(--line-soft) 65%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in oklab, var(--line-soft) 65%, transparent) 1px, transparent 1px);
  background-size: calc(var(--u) * 12.5) calc(var(--u) * 12.5);
  background-position: -1px -1px;
}

.fr-room.basta::before {
  content: '';
  position: absolute;
  inset: 5px;
  border: 2px dashed var(--line);
  border-radius: calc(var(--radius-panel) - 4px);
  pointer-events: none;
}

/* ---- the VIP box ------------------------------------------------------- */

.fr-grp {
  position: absolute;
  border-radius: var(--radius-card);
  border: 1.5px dashed var(--accent-line);
  background: color-mix(in oklab, var(--accent) 7%, transparent);
  pointer-events: none;
}

.fr-grp-name {
  position: absolute;
  top: calc(var(--u) * 0.9);
  left: 0;
  right: 0;
  text-align: center;
  font-size: clamp(9px, calc(var(--u) * 2.6), 12px);
  line-height: 1;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent-text, var(--accent));
}

/* ---- the bar ----------------------------------------------------------- */

/**
 * The heaviest thing on the plan, on purpose: it is the landmark that says
 * which end of the room you are looking at. A solid counter with a lighter edge
 * on the guests' side, where the stools are.
 */
.fr-bar {
  position: absolute;
  z-index: 1;
  border-radius: calc(var(--u) * 1.8);
  background:
    linear-gradient(
      color-mix(in oklab, var(--accent) 30%, var(--surface-3)),
      color-mix(in oklab, var(--accent) 18%, var(--surface-3))
    );
  border: 1px solid var(--accent-line);
  color: var(--ink, var(--text));
  box-shadow: 0 calc(var(--u) * 1.4) calc(var(--u) * 3) calc(var(--u) * -1.4) var(--scrim);
}

/* The guests' edge. An inset shadow and not a border, so the stools — which
   are placed from the counter's box — sit the same distance off every side. */
.fr-bar.rot-0 { box-shadow: inset 0 calc(var(--u) * -1) 0 var(--accent), 0 calc(var(--u) * 1.4) calc(var(--u) * 3) calc(var(--u) * -1.4) var(--scrim); }
.fr-bar.rot-180 { box-shadow: inset 0 calc(var(--u) * 1) 0 var(--accent), 0 calc(var(--u) * 1.4) calc(var(--u) * 3) calc(var(--u) * -1.4) var(--scrim); }
.fr-bar.rot-90 { box-shadow: inset calc(var(--u) * 1) 0 0 var(--accent), 0 calc(var(--u) * 1.4) calc(var(--u) * 3) calc(var(--u) * -1.4) var(--scrim); }
.fr-bar.rot-270 { box-shadow: inset calc(var(--u) * -1) 0 0 var(--accent), 0 calc(var(--u) * 1.4) calc(var(--u) * 3) calc(var(--u) * -1.4) var(--scrim); }

.fr-bar-top {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: calc(var(--u) * 1.2);
  font-size: clamp(10px, calc(var(--u) * 3), 14px);
  line-height: 1;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.fr-bar-top.vertical { writing-mode: vertical-rl; }

.fr-bar-ico {
  width: clamp(11px, calc(var(--u) * 3.2), 16px);
  height: clamp(11px, calc(var(--u) * 3.2), 16px);
  flex-shrink: 0;
  opacity: 0.8;
}

.fr-stool {
  position: absolute;
  border-radius: 50%;
  background: color-mix(in oklab, var(--accent) 22%, var(--surface-2));
  border: 1px solid var(--accent-line);
}

/* ---- the tables -------------------------------------------------------- */

.fr-table {
  position: absolute;
  z-index: 2;
}

.fr-top {
  position: absolute;
  inset: 0;
  display: flex;
}

.fr-top > :deep(*) {
  flex: 1;
  min-width: 0;
}

.fr-chair {
  position: absolute;
  border-radius: calc(var(--u) * 1);
  background: var(--surface);
  border: 1px solid var(--line);
  transition: background var(--dur-fast, 120ms) ease;
}

.fr-table.round .fr-chair { border-radius: 50%; }

/* The chairs take the colour of whoever is sitting in them: occupied reads
   from across the room before any number does. */
.fr-table.tone-a .fr-chair,
.fr-table.tone-busy .fr-chair {
  background: color-mix(in oklab, var(--accent) 55%, var(--bg-2));
  border-color: transparent;
}

.fr-table.tone-b .fr-chair {
  background: color-mix(in oklab, var(--shift-b, var(--accent)) 55%, var(--bg-2));
  border-color: transparent;
}

.fr-table.tone-offered .fr-chair {
  background: var(--accent-soft);
  border: 1px dashed var(--accent-line);
}

/* ---- editing ----------------------------------------------------------- */

.fr-room.editable {
  /* The empty floor still scrolls the page; a table or the bar is dragged. */
  touch-action: pan-y;
}

.editable .fr-table,
.editable .fr-bar {
  cursor: grab;
  touch-action: none;
}

.editable .fr-table:active,
.editable .fr-bar:active { cursor: grabbing; }

.editable .fr-table:focus-visible,
.editable .fr-bar:focus-visible { outline: none; }

/* Rings, drawn as outlines so they follow each shape's own corners. */
.fr-table .fr-top { border-radius: calc(var(--u) * 3.2); }
.fr-table.round .fr-top { border-radius: 50%; }

.fr-table.loose .fr-top { outline: 2px dashed var(--warn); outline-offset: 3px; }

.fr-table.selected .fr-top,
.fr-bar.selected { outline: 2.5px solid var(--accent); outline-offset: 3px; }

.fr-table.clash .fr-top,
.fr-bar.clash { outline: 2.5px solid var(--danger); outline-offset: 3px; }
</style>
