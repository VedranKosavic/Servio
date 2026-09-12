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
    <span class="a-tbl-top">
      <span class="a-tbl-no">{{ cell.label }}</span>
      <!-- Who is holding it. Initials, because a name does not fit and the
           owner knows his own two people by theirs. -->
      <span v-if="cell.waiter" class="a-tbl-who">{{ cell.waiter }}</span>
    </span>

    <template v-if="cell.tab_id">
      <span class="a-tbl-line">
        <template v-if="cell.pending_review">
          <svg
            class="a-tbl-ico" width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true"
          ><rect x="2" y="5" width="20" height="14" rx="2.5" /><path d="M2 10h20" /></svg>
          <span class="a-tbl-wait-text">Čeka naplatu</span>
        </template>
        <template v-else-if="cell.age">
          <svg
            class="a-tbl-ico" width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true"
          ><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          <span class="num">{{ cell.age }}</span>
        </template>
      </span>

      <strong class="a-tbl-amt num">{{ formatAmount(cell.remaining_fen) }}</strong>
    </template>

  </component>
</template>

<style scoped>
/**
 * **A card of facts, not a badge with a number on it.**
 *
 * The tile was the waiter's 68 px square, which is right for him: he is looking
 * for *which* table, walking to it, and the number is the whole job. The owner
 * is doing the opposite — he knows where table 8 is and wants to know what is
 * happening at it — so the tile carries what the tab actually knows: who is
 * holding it, how long it has been open, and what is still owed.
 *
 * 96 px wide is what three runs allow on a 375 px screen once the well's
 * padding and the gaps are taken off (about 101 px each), and the height is the
 * content's rather than a square's, so a free tile stays short and an occupied
 * one takes the two lines it needs.
 *
 * What is deliberately *not* here: a head count and a drinks count. Neither is
 * recorded anywhere in this app — nobody types how many people sat down — so
 * drawing them would be drawing a guess in the same type as the money.
 */
.a-tbl {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  gap: 3px;
  width: 96px;
  min-height: 76px;
  flex-shrink: 0;
  padding: 8px 9px 9px;
  border-radius: var(--radius-card);
  /* No edge on the base — each state brings its own, or none. The old rule put
     a 1.5 px `--line-soft` border on every tile, which on the well's own ground
     was two beiges a shade apart: the free tiles read as smudges and their
     edges competed with the occupied ones for the same attention. */
  border: 0;
  background: transparent;
  color: var(--ink-2);
  font: inherit;
  text-align: center;
  min-width: 0;
  transition:
    transform var(--dur-tap) var(--ease-standard),
    box-shadow var(--dur-fast) var(--ease-standard);
}

button.a-tbl { cursor: pointer; }
button.a-tbl:hover { box-shadow: var(--shadow-pop); }
button.a-tbl.wait:hover { box-shadow: var(--shadow-pop), 0 0 0 2px var(--warn); }
button.a-tbl:active { transform: scale(0.95); }
button.a-tbl:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.a-tbl-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  min-width: 0;
}

.a-tbl-no {
  font-family: var(--font-display);
  font-size: var(--text-section);
  line-height: 1;
  font-weight: 700;
  letter-spacing: -0.01em;
}

/* The colleague's initials, in the same disc the rest of the app puts a person
   in. Dark on every tile, free or taken, so it never becomes a second status. */
.a-tbl-who {
  flex-shrink: 0;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: var(--radius-chip);
  background: var(--nav);
  color: var(--nav-ink);
  font-size: 0.6875rem;
  line-height: 20px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-align: center;
}

/* How long it has been open, or what it is waiting for. One quiet line. */
.a-tbl-line {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-size: var(--text-caption);
  line-height: 1.2;
  font-weight: 500;
  color: var(--muted);
  overflow: hidden;
}

.a-tbl-ico { flex-shrink: 0; }
.a-tbl-wait-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/**
 * A free tile is shorter than a busy one, and that is the point.
 *
 * It briefly carried a chair icon, copied off a mockup — but at 16 px on this
 * grid it read as two ticks and a dash rather than a chair, and seventeen of
 * them is a lot of noise to spend on "nothing is happening here". The number in
 * an outline says it, the legend names it, and the height difference does the
 * rest: a table with guests at it is visibly fuller than one without, before
 * any colour or text is read at all.
 */
.a-tbl.free {
  min-height: 52px;
  justify-content: center;
}

.a-tbl.free .a-tbl-top { justify-content: center; }

/* What is still owed — the loudest thing on an occupied tile, because it is the
   number the owner opened the screen for. */
.a-tbl-amt {
  max-width: 100%;
  margin-top: auto;
  font-family: var(--font-display);
  font-size: var(--text-body);
  line-height: 1.1;
  font-weight: 700;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/**
 * **Outline for empty, fill for taken.** The two states differ in *kind* and not
 * in shade, because shade is what failed here.
 *
 * The version before this tried a ladder of fills — well `--bg-2`, free
 * `--surface-2`, occupied `--surface` — on the theory that a step of value per
 * state is enough. It is not, in this palette: measured, `--bg-2` and
 * `--surface-2` are **three** points apart in every channel. The light kit is a
 * set of warm papers deliberately within a few points of each other, so there
 * is no rung between them to stand on and the free tiles vanished into the
 * ground. Removing their borders at the same time took away the only thing that
 * had been holding them up. (The numbers are in `app/assets/css/admin.css`,
 * which is the one file allowed to spell a colour.)
 *
 * So: a free table is an **outline** — no fill at all, a `--line` edge, which is
 * 16 to 23 points off the well and therefore actually visible — and reads as
 * what it is, an empty slot cut into the floor. An occupied one is **filled**,
 * and filled with `--accent-soft`, the one warm tint in the kit: against a
 * neutral beige it is a shift of hue and not of brightness, which is the
 * difference the eye catches across a room. Every occupied table gets the same
 * one, whoever is serving it and however long they have been sitting.
 */
.a-tbl.free {
  background: transparent;
  border: 1px solid var(--line);
}

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
  background: var(--accent-soft);
  /* The tint's own edge, so the tile is one warm object rather than a warm fill
     inside a grey frame. `--shadow-raise` and not `--shadow-card`: contact
     shadow is what a resting card gets, and these have to lift off a mid-tone
     well, not off white. */
  border: 1px solid var(--accent-line);
  box-shadow: var(--shadow-raise);
  color: var(--accent-ink);
}

.a-tbl.busy .a-tbl-no { color: var(--ink); }
.a-tbl.busy .a-tbl-amt { color: var(--accent-ink); }

/**
 * Somebody has to look at this one. A ring, so the tile still reads as occupied
 * first — the same marker the waiter's plan puts on the same tab.
 *
 * A `box-shadow` ring and not `outline: … offset: 2px`. The tiles sit 10 px
 * apart, so an outline standing 2 px off the edge spent 4 px of that gap and
 * came within a hair of its neighbour; this hugs the border instead, costs no
 * geometry at all, and stacks over the raise rather than replacing it.
 */
.a-tbl.wait {
  box-shadow: var(--shadow-raise), 0 0 0 2px var(--warn);
}

/** One step down so three runs still fit a 360 px screen. */
@media (max-width: 374px) {
  .a-tbl { width: 88px; padding: 7px 8px 8px; }
}
</style>
