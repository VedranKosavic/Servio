<script setup lang="ts">
/**
 * One table of the owner's floor plan — the waiter's `FloorTable` in the other
 * material, and now with the waiter's states as well as his geometry.
 *
 * **One colour for one meaning.** The tile used to be tinted in three shades of
 * how long the guests had been sitting, with a five-word legend under the plan.
 * The owner's words: *"Lets adjust this preview of tables to match the waiter.
 * We can now remove all the reservations, etc.. all should be same color."* So
 * there are two states here and no third: **free** — the quietest thing on the
 * plan, the well's own ground with a soft rule and a muted number — and
 * **occupied**, which is one raised step with an edge you can see and what is
 * still owed on it. Every occupied table looks exactly like every other one.
 *
 * That is also the waiter's own rule, one role along. His plan is free / a
 * colleague's / mine, where *mine* is the only copper on the screen because
 * copper marks the person's own state and nothing else. The owner has no table
 * of his own, so every occupied table gets the material his colleague's tiles
 * get, and no tile on this screen is ever copper.
 *
 * `pending_review` — *naplata čeka*, somebody has to look at this one — stays as
 * the same warm ring the waiter's tile draws, because it is a thing to *notice*
 * rather than a fourth colour of table. It is a ring and not a fill, so the tile
 * underneath still reads as occupied.
 *
 * **Nothing here shares a rule with `/konobar`.** The shape, the size, the
 * radius and the layout are the waiter's; the values come from tokens that
 * resolve under `[data-theme='light']`, because the dark screens and this one
 * are two materials on one set of names (DESIGN §2) and the two never share a
 * CSS rule. His component is untouched.
 *
 * The age is not drawn on the tile any more — it was the second encoding of a
 * tint that is gone. It stays in the tile's accessible name and in the sheet
 * that opens when it is tapped, which is where a number belongs when it is not
 * a colour.
 */
import type { PulsFloorCell } from '~/utils/puls'

const props = defineProps<{ cell: PulsFloorCell }>()

defineEmits<{ open: [] }>()

/**
 * What a screen reader says instead of "button, 7".
 *
 * A free table is its name and nothing else. An occupied one carries the two
 * facts the tile shows plus the age it no longer prints, because the reader
 * cannot open the sheet to find it.
 */
const label = computed(() => {
  const cell = props.cell
  if (!cell.tab_id) return `${cell.name}, slobodan`
  return [
    cell.name,
    formatKm(cell.remaining_fen),
    cell.age,
    cell.pending_review ? 'naplata čeka' : '',
  ].filter(Boolean).join(', ')
})
</script>

<template>
  <component
    :is="cell.tab_id ? 'button' : 'div'"
    class="a-tbl"
    :class="[cell.tab_id ? 'busy' : 'free', { wait: cell.pending_review }]"
    :type="cell.tab_id ? 'button' : undefined"
    :aria-label="label"
    @click="cell.tab_id && $emit('open')"
  >
    <span class="a-tbl-no">{{ cell.label }}</span>
    <small v-if="cell.tab_id" class="a-tbl-amt num">{{ formatAmount(cell.remaining_fen) }}</small>
  </component>
</template>

<style scoped>
/* The waiter's tile, to the pixel: 68 px, `--radius-card`, the number in the
   display face with the second line under it. */
.a-tbl {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 68px;
  height: 68px;
  flex-shrink: 0;
  padding: 0 4px;
  border-radius: var(--radius-card);
  border: 1.5px solid var(--line-soft);
  background: transparent;
  color: var(--muted);
  font: inherit;
  text-align: center;
  min-width: 0;
  transition:
    transform var(--dur-tap) var(--ease-standard),
    box-shadow var(--dur-fast) var(--ease-standard);
}

button.a-tbl { cursor: pointer; }
button.a-tbl:hover { box-shadow: var(--shadow-raise); }
button.a-tbl:active { transform: scale(0.95); }
button.a-tbl:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.a-tbl-no {
  font-family: var(--font-display);
  font-size: var(--text-section);
  line-height: 1;
  font-weight: 700;
  letter-spacing: -0.01em;
}

/* The amount, and the whole reason the tile is a square and not a circle: it
   gets the full width of the tile and a real type step. */
.a-tbl-amt {
  max-width: 100%;
  font-size: var(--text-label);
  line-height: 1.1;
  font-weight: 600;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/**
 * Free: the quietest thing on the plan — the well's own ground showing through,
 * a soft rule, a muted number. An empty table is a slot in the room, not an
 * object in it.
 */
.a-tbl.free .a-tbl-no { color: var(--muted); }

/**
 * Occupied: raised material with an edge you can see — **one colour for every
 * table with guests at it**, whoever is serving them and however long they have
 * been sitting there.
 *
 * On the waiter's dark screen "raised" is a step *up* the surface ladder; on
 * paper it is the card white that every other object on the dashboard is made
 * of, plus the same hairline of contact shadow. Same relationship, opposite
 * material — which is the rule for everything that exists on both sides
 * (DESIGN §2).
 */
.a-tbl.busy {
  background: var(--surface);
  border-color: var(--line);
  box-shadow: var(--shadow-card);
  color: var(--ink-2);
}

.a-tbl.busy .a-tbl-no { color: var(--ink); }

/* Somebody has to look at this one. A ring, so the tile still reads as occupied
   first — the same marker the waiter's plan puts on the same tab. */
.a-tbl.wait {
  outline: 2px solid var(--warn);
  outline-offset: 2px;
}

/**
 * One step down so the whole room fits a narrow phone.
 *
 * *Unutra* is three runs of tables with the VIP pair boxed under the last of
 * them, so the widest line of the plan is four tiles plus the box's own edges.
 * At 68 px that is about 340 px, which fits a 390 px screen and not a 360 px
 * one — and a plan the owner has to drag sideways to see the end of is not a
 * plan of the room. 60 px still carries the number and the amount.
 */
@media (max-width: 374px) {
  .a-tbl { width: 60px; height: 62px; }
}
</style>
