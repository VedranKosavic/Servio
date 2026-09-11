<script setup lang="ts">
/**
 * *Stolovi* — the room from above, the way `/konobar` draws it.
 *
 * The owner asked for the waiter's floor plan on his own screen: "mimic and
 * make it same as we did for waiter screen, showing live state of the tables".
 * So the geometry is the waiter's exactly — one vertical stack per `col`,
 * ordered by `row`, the stacks spread across the width, a boxed group (today
 * the VIP pair) under the column it hangs off, and the whole plan sitting in an
 * inset well, because the room is a space the tables stand *in* rather than a
 * list of cards. `floorZones()` in `app/utils/puls.ts` builds it out of the
 * catalogue's own coordinates, so adding a table to the database adds it here.
 *
 * **Both zones at once, and no switch.** The waiter picks a half of the room
 * because he is walking to one of them; the owner is watching the whole night
 * and should not have to tap to see half of it. *Unutra* and *Bašta* are two
 * labelled wells, stacked.
 *
 * **Nothing here shares a rule with `/konobar`.** The dark screens and this one
 * are two materials on one set of token names (DESIGN §2), so the plan is
 * rebuilt against the light theme rather than imported — the waiter's own
 * component and its scoped CSS are untouched.
 */
import type { PulsFloorCell, PulsFloorZone } from '~/utils/puls'

const props = defineProps<{
  zones: PulsFloorZone[]
  loading?: boolean
}>()

defineEmits<{ open: [cell: PulsFloorCell] }>()

/** "6 od 27 zauzeto" — the one number a card head is worth. */
const count = computed(() => {
  const busy = props.zones.reduce((n, zone) => n + zone.busy, 0)
  const total = props.zones.reduce((n, zone) => n + zone.total, 0)
  return total ? `${busy} od ${total} zauzeto` : undefined
})
</script>

<template>
  <UiCard title="Stolovi" :count="count">
    <template v-if="zones.length">
      <div v-for="zone in zones" :key="zone.zone" class="a-zone">
        <div class="a-zone-label">{{ zone.label }}</div>

        <div class="a-room">
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
          </div>
        </div>
      </div>

      <!-- The caption on the plan: colour never carries a meaning on its own,
           so every marker is drawn beside the word it stands for. -->
      <ul class="a-legend">
        <li><i class="a-key k-free" />slobodan</li>
        <li><i class="a-key k-fresh" />do 1 h</li>
        <li><i class="a-key k-warm" />1–3 h</li>
        <li><i class="a-key k-old" />preko 3 h</li>
        <li><i class="a-key k-wait" />čeka</li>
      </ul>
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
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 12px;
  border-radius: var(--radius-card);
  background: var(--bg-2);
  border: 1px solid var(--line-soft);
  overflow-x: auto;
}

/* A stack shorter than the tallest one is centred against it (`align-items:
   center` above), so Bašta's three sit level with the middle of the seven —
   which is what the owner's sketch of the garden shows. */
.a-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

/* Tables with a group — today only the VIP pair — are drawn in their own dashed
   box, because their coordinates are relative to that box and would otherwise
   collide with the main grid. */
.a-grp {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 8px;
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

.a-grp-row { display: flex; gap: 8px; }

.a-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  margin: 0;
  padding: 10px 0 0;
  list-style: none;
  border-top: 1px solid var(--line-soft);
  font-size: var(--text-caption);
  letter-spacing: 0;
  color: var(--muted);
}

.a-legend li { display: flex; align-items: center; gap: 6px; }

/* The markers are the tiles in miniature — same fills, same edges, so the key
   and the plan cannot drift apart. */
.a-key {
  display: inline-block;
  width: 11px;
  height: 11px;
  flex-shrink: 0;
  border-radius: 4px;
  border: 1px solid var(--line-soft);
  background: var(--surface);
}

.k-free { background: var(--bg-2); border-color: var(--line-soft); }
.k-fresh { background: var(--good-soft); }
.k-warm { background: var(--warn-soft); }
.k-old { background: var(--danger-soft); }
.k-wait { background: transparent; border: 2px solid var(--warn); }

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
    padding: 12px 8px;
    border-radius: 0;
    border-inline: 0;
  }
}
</style>
