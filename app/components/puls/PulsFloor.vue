<script setup lang="ts">
/**
 * *Stolovi* — the room from above, the way `/konobar` draws it.
 *
 * The geometry is the waiter's exactly — one vertical stack per `col`, ordered by
 * `row`, the stacks spread across the width, a boxed group (today the VIP pair)
 * under the column it hangs off, and the whole plan sitting in an inset well,
 * because the room is a space the tables stand *in* rather than a list of cards.
 * `floorZones()` in `app/utils/puls.ts` builds it out of the catalogue's own
 * coordinates, so adding a table to the database adds it here.
 *
 * **The legend is gone, and so is everything it named.** It keyed five colours —
 * free, under an hour, one to three, over three, waiting — and the owner asked
 * for the waiter's plan instead: one colour for every occupied table. Two states
 * need no key, so the foot of the plan is now the plan.
 *
 * What the five words did carry, and what the card head carries in their place,
 * is the count: *"6 od 27 zauzeto · 1 čeka naplatu"*. A ring around a tile is a
 * thing to notice rather than a colour to look up, and the number of them is a
 * fact worth reading before the owner has looked at a single tile.
 *
 * **One zone at a time, switched — the waiter's own control.** This screen was
 * built the other way, on the argument that the owner is watching the whole
 * night and should not tap to see half of it. On a 390 px phone that argument
 * loses to arithmetic: two stacked wells are about seventeen hundred pixels of
 * plan, so the room became two screens tall and *Bašta* lived permanently below
 * the fold — a floor plan you have to scroll is not a floor plan. One zone at a
 * time fits a screen with the legend under it and nothing cut off, and the tap
 * that costs is the same tap the waiter already makes on his.
 *
 * The count in the head is the whole room, both zones, so the number the owner
 * reads first never depends on which half he is looking at.
 *
 * **Nothing here shares a rule with `/konobar`.** The dark screens and this one
 * are two materials on one set of token names (DESIGN §2), so the plan is rebuilt
 * against the light theme rather than imported — the waiter's own component and
 * its scoped CSS are untouched.
 */
import type { PulsFloorCell, PulsFloorZone } from '~/utils/puls'

const props = defineProps<{
  zones: PulsFloorZone[]
  loading?: boolean
}>()

defineEmits<{ open: [cell: PulsFloorCell] }>()

/** Every tile of every zone, once — the boxed groups included. */
const cells = computed(() => props.zones.flatMap(zone =>
  zone.columns.flatMap(column => [...column.cells, ...column.groups.flatMap(g => g.cells)])))

/** Which half of the room is on screen. The first zone until he says otherwise. */
const shown = ref<string>('')

/**
 * *Unutra 10* · *Bašta 3* — the switch carries each half's own count.
 *
 * The control used to be two words in a grey track that ran the full width of
 * the card, most of it empty (`UiSeg`'s `width: max-content` is the fix, and the
 * comment there is the post-mortem). Making it fit its labels leaves room for
 * the one thing it was missing: the head's "10 od 27 zauzeto" is the whole room,
 * and the owner's next question is which half they are in. Now he reads it
 * without tapping — and the segment stops being two words he has to try.
 */
const zoneOptions = computed(() => props.zones.map(zone => ({
  value: zone.zone,
  label: zone.label,
  // Always, including zero: *Bašta 0* is the answer to "is there anybody
  // outside", and a segment whose neighbour carries a number and it does not
  // reads as a control that has half loaded.
  hint: `${zone.busy}`,
})))

watch(() => props.zones, (list) => {
  if (list.length && !list.some(zone => zone.zone === shown.value)) {
    shown.value = list[0]!.zone
  }
}, { immediate: true })

const visibleZones = computed(() => (props.zones.length > 1
  ? props.zones.filter(zone => zone.zone === shown.value)
  : props.zones))

/** "6 od 27 zauzeto · 1 čeka naplatu" — the one line a card head is worth. */
const count = computed(() => {
  const busy = props.zones.reduce((n, zone) => n + zone.busy, 0)
  const total = props.zones.reduce((n, zone) => n + zone.total, 0)
  if (!total) return undefined
  const waiting = cells.value.filter(cell => cell.pending_review).length
  const parts = [`${busy} od ${total} zauzeto`]
  if (waiting) parts.push(`${waiting} čeka naplatu`)
  return parts.join(' · ')
})
</script>

<template>
  <UiCard title="Stolovi" :count="count">
    <template v-if="zones.length">
      <UiSeg
        v-if="zones.length > 1"
        v-model="shown"
        label="Zona"
        :options="zoneOptions"
      />

      <div v-for="zone in visibleZones" :key="zone.zone" class="a-zone">
        <div v-if="zones.length === 1" class="a-zone-label">{{ zone.label }}</div>

        <div class="a-room" :class="{ inside: zone.zone === 'unutra' }">
            <!-- The room itself: the walls it is built of and what stands in
               the corners. Decoration, so the screen reader never meets it,
               and absolutely positioned so it costs the runs no width. -->
          <span v-if="zone.zone === 'unutra'" class="a-decor" aria-hidden="true">
            <span class="a-wall a-wall-slats" />
            <span class="a-wall a-wall-bench" />
            <svg class="a-plant a-plant-a" viewBox="0 0 24 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20V9" />
              <path d="M12 13c-3-1-5-4-4.5-7C10 6 12 9 12 13z" />
              <path d="M12 15c3-1.4 5-4.6 4.2-7.6C13.4 8 12 11 12 15z" />
              <path d="M8 20h8l-1 9H9z" />
            </svg>
            <svg class="a-plant a-plant-b" viewBox="0 0 24 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20V10" />
              <path d="M12 14c-3.2-1-5.2-4.2-4.6-7.2C10.4 7.2 12 10 12 14z" />
              <path d="M12 16c3.2-1.4 5-4.8 4-7.8C13 9 12 12 12 16z" />
              <path d="M8 20h8l-1 9H9z" />
            </svg>
          </span>

          <div class="a-room-grid">

          <div
            v-for="column in zone.columns"
            :key="column.col"
            class="a-col"
          >
            <PulsFloorTable
              v-for="cell in column.cells"
              :key="cell.table_id"
              :cell="cell"
              @open="$emit('open', cell)"
            />

            <div
              v-for="group in column.groups"
              :key="group.name"
              class="a-grp"
            >
              <span class="a-grp-label">{{ group.name }}</span>
              <div class="a-grp-row">
                <PulsFloorTable
                  v-for="cell in group.cells"
                  :key="cell.table_id"
                  :cell="cell"
                  @open="$emit('open', cell)"
                />
              </div>
            </div>

            <!-- The room's architecture: a third material, so it can never be
                 read as a table that happens to be shaped oddly. -->
            <div v-if="column.foot" class="a-fixture">
              <svg
                class="a-fixture-ico" width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                aria-hidden="true"
              ><path d="M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" /><path d="M17 9h2a2.5 2.5 0 0 1 0 5h-2" /><path d="M5 21h12" /></svg>
              {{ column.foot }}
            </div>
          </div>
          </div>

          <!-- The legend is the foot of the same well, behind a hairline, so it
               reads as a caption on the plan rather than a row of controls under
               it — the waiter's placement, one material along. -->
          <ul class="a-key">
            <li><i class="a-key-dot busy" />zauzet</li>
            <li><i class="a-key-dot free" />slobodan</li>
            <li><i class="a-key-dot wait" />čeka naplatu</li>
          </ul>
        </div>
      </div>
    </template>

    <p v-else class="a-empty">
      {{ loading ? 'Učitavanje…' : 'Nema stolova u rasporedu.' }}
    </p>
  </UiCard>
</template>

<style scoped>
.a-zone { display: flex; flex-direction: column; gap: 8px; }

.a-zone-label {
  font-size: var(--text-caption);
  line-height: 1.3;
  text-transform: uppercase;
  letter-spacing: 0.11em;
  color: var(--muted);
  font-weight: 600;
}

/* The room is an inset well, exactly as it is on the waiter's screen: the
   tables sit *in* a space rather than on a card. `overflow-x` is on the well
   and not on the page, so a café that grows a fourth run of tables scrolls the
   plan and never the dashboard. */
/**
 * The room, as a room.
 *
 * The floor is `--bg-2` with a set of hairlines running away from the viewer —
 * boards, not a photograph. The owner asked for the background of a mockup that
 * used a photo-real wood texture; a photograph behind numbers read at a glance
 * in a dim café costs contrast and buys nothing, and it would mean colours from
 * outside the one file allowed to spell them. Spacing the boards at 44 px and
 * drawing them in `--line-soft` gives the ground a direction and a grain and
 * stays under the tiles rather than competing with them.
 */
.a-room {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 16px 12px 12px;
  border-radius: var(--radius-panel);
  background: var(--bg-2);
  border: 1px solid var(--line);
}

/* Room enough at the sides for the two walls and what leans against them. */
.a-room.inside { padding-left: 26px; padding-right: 26px; }

/**
 * On a phone that channel is the most expensive decoration on the screen: 52 px
 * of a 341 px room, a sixth of the plan, spent on two strips of wall. The walls
 * get thinner instead of the plan getting narrower — the tables are the room and
 * the walls are the frame around it. The rules that thin them are at the foot of
 * this file, with the rest of the phone block, because they have to come **after**
 * the base `.a-wall` rule to win: same specificity, so source order decides.
 */
@media (max-width: 1023px) {
  .a-room.inside { padding-left: 16px; padding-right: 16px; }
}

.a-room.inside {
  background-image: repeating-linear-gradient(
    90deg,
    transparent 0 43px,
    var(--line-soft) 43px 44px
  );
}

/**
 * Under the tiles, over the floor, invisible to anything that reads.
 *
 * It hangs on the well and **not** on the run of tables, which scrolls: an
 * absolutely positioned child of a scroll container still extends its scroll
 * width, so the first version of this quietly added twelve pixels of sideways
 * drag to a plan that had just been made to fit.
 */
.a-decor {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

/**
 * The two long walls, drawn in the well's own padding so the runs of tables
 * keep every pixel of the width they had.
 *
 * Left is the slatted screen — vertical battens, warm, `--accent-line` being
 * the one wood-ish tone in the kit. Right is the banquette: a padded strip with
 * the horizontal channels the bench actually has, in the grey family so it
 * cannot be mistaken for a table.
 */
.a-wall {
  position: absolute;
  top: 12px;
  bottom: 12px;
  width: 10px;
  border-radius: 3px;
}

.a-wall-slats {
  left: 6px;
  background-image: repeating-linear-gradient(
    180deg,
    var(--accent-line) 0 3px,
    transparent 3px 7px
  );
  opacity: 0.8;
}

.a-wall-bench {
  right: 6px;
  background: var(--surface-2);
  background-image: repeating-linear-gradient(
    180deg,
    var(--line) 0 1px,
    transparent 1px 8px
  );
  border: 1px solid var(--line);
}

/* Two pots, in the corners the tables do not reach. */
.a-plant {
  position: absolute;
  width: 24px;
  height: 32px;
  color: var(--line);
}

.a-plant-a { top: 10px; left: 1px; }
.a-plant-b { bottom: 10px; right: 1px; }

/**
 * **Laptop only**, and that is the honest answer rather than a shrunken one.
 *
 * A pot needs a corner, and a phone's room has none: the side channel is 16 px
 * wide and a wall already lives in it, so a plant there either overlaps the
 * first table or is scaled down to a 16 px smudge. Both are worse than the
 * corner being empty. On a laptop the channel is 26 px and the room has slack
 * either side, which is where the plants read as plants.
 */
@media (max-width: 1023px) {
  .a-plant { display: none; }
}

/* The runs of tables. `overflow-x` is on this and not on the page, so a café
   that grows a fourth run scrolls the plan and never the dashboard. */
.a-room-grid {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  overflow-x: auto;
}

/* The tiles sit on the room, never under it. */
.a-room-grid > .a-col { position: relative; z-index: 1; }

/* A stack shorter than the tallest one is centred against it (`align-items:
   center` above), so Bašta's three sit level with the middle of the seven —
   which is what the owner's sketch of the garden shows. 12 px between tiles is
   the waiter's own spacing. */
.a-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

/* Tables with a group — today only the VIP pair — are drawn in their own dashed
   box, because their coordinates are relative to that box and would otherwise
   collide with the main grid. */
.a-grp {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 8px 12px 12px;
  border-radius: var(--radius-card);
  border: 1px dashed var(--line);
}

.a-grp-label {
  font-size: var(--text-caption);
  text-transform: uppercase;
  letter-spacing: 0.11em;
  color: var(--muted);
  font-weight: 600;
}

/**
 * The boxed pair, abreast — on every screen.
 *
 * It was stacked on a phone for exactly one release, to buy back the width the
 * room's new walls had taken. That was the wrong thing to spend: the plan's
 * whole job is to be a picture of the room, and two tables drawn one above the
 * other are a different corner of it. The width comes out of the box's own
 * padding instead (see the phone block at the foot of this file), which leaves
 * the widest line of the plan — two runs, the box, two gaps — inside what the
 * well has to give at 375 px, with the tiles stepping down to 60 px below that.
 */
.a-grp-row { display: flex; gap: 12px; }

/**
 * The bar, and anything else the room has that is not a table.
 *
 * A solid slab, where a free table is an outline and a taken one a warm fill —
 * three materials for three kinds of thing, so nothing on the plan is ambiguous
 * at a glance. It is deliberately the heaviest of them: it is the one landmark
 * that tells the owner which end of the grid he is looking at.
 */
.a-fixture {
  position: relative;
  z-index: 1;
  width: 68px;
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  border-radius: var(--radius-field);
  background: var(--nav);
  color: var(--nav-ink);
  font-size: var(--text-caption);
  line-height: 1.3;
  text-transform: uppercase;
  letter-spacing: 0.11em;
  font-weight: 700;
  text-align: center;
  gap: 5px;
}

.a-fixture-ico { flex-shrink: 0; opacity: 0.75; }

/* The bar is as wide as a table, at every step of the tile — it stands at the
   foot of a run and a slab half a tile out of line reads as a mistake. */
@media (max-width: 430px) {
  .a-fixture { width: 62px; }
}

@media (max-width: 374px) {
  .a-fixture { width: 60px; }
}

.a-key {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 16px;
  margin: 0;
  padding: 12px 0 0;
  list-style: none;
  border-top: 1px solid var(--line);
  font-size: var(--text-caption);
  color: var(--muted);
}

.a-key li { display: flex; align-items: center; gap: 6px; }

.a-key-dot {
  width: 12px;
  height: 12px;
  border-radius: 4px;
  flex-shrink: 0;
}

.a-key-dot.free { border: 1px solid var(--line); }
.a-key-dot.busy { background: var(--accent-soft); border: 1px solid var(--accent-line); }
.a-key-dot.wait { background: var(--accent-soft); border: 1px solid var(--accent-line); box-shadow: 0 0 0 2px var(--warn); }

.a-empty { margin: 0; color: var(--muted); font-size: var(--text-label); }

/**
 * On a phone the room reaches the card's own edges.
 *
 * The same reason `UiCard`'s `flush` exists for a dense table: three runs of
 * tables and a boxed VIP pair need every pixel of a 375 px screen, and a room
 * inset by the card's 16 px gutters is a room the owner has to drag sideways to
 * see the end of. The card's own padding is given back as a negative margin, so
 * one rule moves the plan instead of a second set of paddings drifting out of
 * step with the card's.
 */
@media (max-width: 1023px) {
  .a-room {
    margin-inline: -16px;
    padding: 14px 8px;
    border-radius: 0;
    border-inline: 0;
  }

  /* Thinner walls for the narrower channel — 8 px of wall in 16 px of padding
     leaves the first table 5 px of air, which is the gap the 26 px channel
     gives it on a laptop. */
  .a-wall { width: 8px; }
  .a-wall-slats { left: 3px; }
  .a-wall-bench { right: 3px; }

  .a-col { gap: 10px; }
  .a-grp-row { gap: 10px; }

  /* The four pixels a side that keep the VIP pair abreast: the box is the one
     thing on the plan whose padding is decoration rather than geometry, so it
     is what gives way when the room is narrow. */
  .a-grp { padding: 8px 8px 10px; }
}
</style>
