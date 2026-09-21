<script setup lang="ts">
/**
 * *Stolovi* — the room from above, the way `/konobar` draws it.
 *
 * The geometry is the waiter's exactly: every table where the owner dragged it
 * on *Stolovi*, the bar with it, drawn by the same `FloorRoom`. `floorZones()`
 * in `app/utils/puls.ts` joins it to the live read, so adding a table to the
 * database adds it here too, parked under the room until somebody places it.
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
 * **The room is the waiter's room.** Where things stand is the owner's own
 * arrangement from *Stolovi*, and `FloorRoom` draws it — floor, walls, bar,
 * chairs — for both screens, in token names that each theme resolves to its own
 * material (DESIGN §2). What stays separate is the tile: this one is light, has
 * one colour for every occupied table, and opens the owner's sheet.
 */
import type { PulsFloorCell, PulsFloorZone } from '~/utils/puls'
import type { ChairTone } from '~/components/FloorRoom.vue'

const props = defineProps<{
  zones: PulsFloorZone[]
  loading?: boolean
  /**
   * Who is on the open shift, by name — the owner's call moved *Ko radi* into
   * this head. Empty when nothing is open, and then the head names nobody.
   */
  workers?: string[]
}>()

defineEmits<{ open: [cell: PulsFloorCell] }>()

/** Every tile of every zone, once — the boxed groups included. */
const cells = computed(() => props.zones.flatMap(zone => zone.cells))

/** A tile's content by table id, for the room's slots. */
const byId = computed(() => new Map(cells.value.map(cell => [cell.table_id, cell])))

/** One colour of chair for every table with guests at it, as the tiles have. */
function toneOf(id: string): ChairTone {
  return byId.value.get(id)?.tab_id ? 'busy' : 'free'
}

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

/** "6 od 27 zauzeto · 1 čeka naplatu · Radi: Amar, Emir" — the one line a card head is worth. */
const count = computed(() => {
  const busy = props.zones.reduce((n, zone) => n + zone.busy, 0)
  const total = props.zones.reduce((n, zone) => n + zone.total, 0)
  if (!total) return undefined
  const waiting = cells.value.filter(cell => cell.pending_review).length
  const parts = [`${busy} od ${total} zauzeto`]
  if (waiting) parts.push(`${waiting} čeka naplatu`)
  if (props.workers?.length) parts.push(`Radi: ${props.workers.join(', ')}`)
  return parts.join(' · ')
})
</script>

<template>
  <UiCard title="Stolovi" :count="count">
    <!-- This plan is for watching the room; it is arranged on Stolovi. The way
         there sits on the plan itself, because this is where the owner looks
         for it — "I can't move tables at all" was asked on this screen. -->
    <template #actions>
      <NuxtLink to="/admin/kontrola/stolovi" class="a-edit">
        Uredi raspored
        <UiIcon name="chevron-right" :size="16" />
      </NuxtLink>
    </template>

    <template v-if="zones.length">
      <UiSeg
        v-if="zones.length > 1"
        v-model="shown"
        label="Zona"
        :options="zoneOptions"
      />

      <div v-for="zone in visibleZones" :key="zone.zone" class="a-zone">
        <div v-if="zones.length === 1" class="a-zone-label">{{ zone.label }}</div>

        <FloorRoom class="a-room" :plan="zone.plan" :tone="toneOf">
          <template #table="{ table }">
            <PulsFloorTable
              v-if="byId.get(table.id)"
              :cell="byId.get(table.id)!"
              :shape="table.shape"
              @open="$emit('open', byId.get(table.id)!)"
            />
          </template>
        </FloorRoom>

        <ul class="a-key">
          <li><i class="a-key-dot busy" />zauzet</li>
          <li><i class="a-key-dot free" />slobodan</li>
          <li><i class="a-key-dot wait" />čeka naplatu</li>
        </ul>
      </div>
    </template>

    <p v-else class="a-empty">
      {{ loading ? 'Učitavanje…' : 'Nema stolova u rasporedu.' }}
    </p>
  </UiCard>
</template>

<style scoped>
.a-zone { display: flex; flex-direction: column; gap: 10px; }

.a-zone-label {
  font-size: var(--text-caption);
  line-height: 1.3;
  text-transform: uppercase;
  letter-spacing: 0.11em;
  color: var(--muted);
  font-weight: 600;
}

/* The room at a size a laptop column and a phone both give it: the whole width
   on a phone, and never so wide on a laptop that a table is a poster. */
.a-room {
  width: 100%;
  max-width: 480px;
  margin-inline: auto;
}

.a-key {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px 16px;
  margin: 0;
  padding: 0;
  list-style: none;
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

.a-key-dot.free { background: var(--surface); border: 1px solid var(--line); }
.a-key-dot.busy { background: var(--accent-soft); border: 1px solid var(--accent-line); }
.a-key-dot.wait { background: var(--accent-soft); border: 1px solid var(--accent-line); box-shadow: 0 0 0 2px var(--warn); }

.a-empty { margin: 0; color: var(--muted); font-size: var(--text-label); }

.a-edit {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-height: 34px;
  padding: 0 8px 0 12px;
  border-radius: var(--radius-field);
  background: var(--accent-soft);
  color: var(--accent-ink);
  font-size: var(--text-label);
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}

.a-edit:hover { background: color-mix(in oklab, var(--accent) 22%, var(--accent-soft)); }
.a-edit:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
