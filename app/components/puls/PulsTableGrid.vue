<script setup lang="ts">
/**
 * *Stolovi* — the floor plan, coloured by how long the guests have been sitting.
 *
 * Four across, grouped *Unutra* / *Bašta* exactly as the room is, with the
 * legend underneath. The colour bands are free (outline), under an hour, one to
 * three hours, over three — and every occupied tile prints the age in words
 * beside the name, so the band is a shortcut and never the message: a
 * colour-blind owner, a screenshot in a chat, and a bright afternoon all have to
 * read the same thing.
 *
 * A tile with a tab is a button: tapping it opens that table's rounds. A free
 * table is not clickable, because there is nothing behind it to open.
 */
import type { PulsTableTile, PulsZoneGroup } from '~/utils/puls'

defineProps<{
  groups: PulsZoneGroup[]
  loading?: boolean
}>()

const emit = defineEmits<{ open: [tile: PulsTableTile] }>()
</script>

<template>
  <UiCard title="Stolovi">
    <template v-if="groups.length">
      <div v-for="group in groups" :key="group.zone" class="a-zone">
        <div class="a-zone-label">{{ group.label }}</div>
        <div class="a-grid4">
          <component
            :is="tile.tab_id ? 'button' : 'div'"
            v-for="tile in group.tiles"
            :key="tile.table_id"
            class="a-tbl"
            :class="`h-${tile.tone}`"
            :type="tile.tab_id ? 'button' : undefined"
            @click="tile.tab_id && emit('open', tile)"
          >
            <span class="a-tbl-top">
              <b>{{ tile.name }}</b>
              <small v-if="tile.age">{{ tile.age }}</small>
            </span>
            <span v-if="tile.tab_id" class="a-tbl-sub">
              {{ tile.waiter }} · {{ formatAmount(tile.remaining_fen) }}<template
                v-if="tile.pending_review"
              > · čeka</template>
            </span>
          </component>
        </div>
      </div>

      <div class="a-legend">
        <UiPill tone="neutral">slobodan</UiPill>
        <UiPill tone="good">&lt; 1 h</UiPill>
        <UiPill tone="warn">1–3 h</UiPill>
        <UiPill tone="bad">&gt; 3 h</UiPill>
      </div>
    </template>

    <p v-else class="a-zone-empty">
      {{ loading ? 'Učitavanje…' : 'Nema stolova u rasporedu.' }}
    </p>
  </UiCard>
</template>

<style scoped>
.a-zone { display: flex; flex-direction: column; gap: 8px; }

.a-zone-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  font-weight: 600;
}

.a-grid4 {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.a-tbl {
  height: 56px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--surface);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: 0 10px;
  font: inherit;
  font-size: 13px;
  color: var(--ink);
  text-align: left;
  min-width: 0;
}

button.a-tbl { cursor: pointer; }

.a-tbl-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 2px;
  min-width: 0;
}

/* On a 104 px phone tile "Sto 12" and "1 h 40" only just fit — and measured at
   390 px they did not: the name needed 42 px and got 40, so every busy table
   read "Sto …". The name is the one identifier the owner needs and the colour
   already carries the age, so the two pixels come out of the gap and the age's
   font size instead of out of the name. */
.a-tbl-top b {
  font-size: 14px;
  white-space: nowrap;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.a-tbl-top small {
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.a-tbl-sub {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
}

.h-fresh { background: var(--good-soft); border-color: var(--good); }
.h-warm { background: var(--warn-soft); border-color: var(--warn); }
.h-old { background: var(--danger-soft); border-color: var(--danger); }

.a-legend { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

.a-zone-empty { margin: 0; color: var(--muted); font-size: 14px; }

@media (max-width: 1023px) {
  /* Three across on a 390 px phone keeps each tile wide enough for
     "Sto 12 · 1 h 40" and each target well over 44 px. */
  .a-grid4 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .a-tbl { height: 62px; }
}
</style>
