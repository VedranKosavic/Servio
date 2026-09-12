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

const zoneOptions = computed(() =>
  props.zones.map(zone => ({ value: zone.zone, label: zone.label })))

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

        <div class="a-room">
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
            <div v-if="column.foot" class="a-fixture">{{ column.foot }}</div>
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
.a-room {
  display: flex;
  flex-direction: column;
  padding: 16px 12px 12px;
  border-radius: var(--radius-panel);
  background: var(--bg-2);
  border: 1px solid var(--line);
}

/* The runs of tables. `overflow-x` is on this and not on the page, so a café
   that grows a fourth run scrolls the plan and never the dashboard. */
.a-room-grid {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  overflow-x: auto;
}

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
  width: 68px;
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  border-radius: var(--radius-field);
  background: var(--line);
  color: var(--ink-2);
  font-size: var(--text-caption);
  line-height: 1.3;
  text-transform: uppercase;
  letter-spacing: 0.11em;
  font-weight: 700;
  text-align: center;
}

@media (max-width: 374px) {
  .a-fixture { width: 60px; }
}

.a-key {
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

  .a-col { gap: 10px; }
  .a-grp-row { gap: 10px; }
}
</style>
