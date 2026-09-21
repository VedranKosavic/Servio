<script setup lang="ts">
/**
 * *Raspored sale* — the room, arranged by hand.
 *
 * The owner's ask, word for word: *"Allow me to move tables how I want in admin
 * table — once I click save then we should save that and it shouldn't change
 * again. Its easier like this than to explain you the position of each
 * table."* So this is the room exactly as the waiter's phone draws it, with
 * every table and the bar draggable, and one button that makes it true.
 *
 * **Nothing moves anywhere until *Sačuvaj*.** Dragging edits a working copy on
 * this screen only; *Poništi* throws it away. Saving writes the whole
 * arrangement at once (`PUT /api/admin/floor`) — every table in both zones, the
 * ones never touched included — so from then on no table's place is computed
 * again, and the phones pick it up on their next poll.
 *
 * **The working copy starts materialised.** Before the first save nothing is
 * stored and the plan is `autoLayout()`'s; the copy starts as that picture with
 * every spot written out, so dragging one table cannot make the others jump
 * (a layout that names one table and not the rest parks the rest under it).
 *
 * Two tops on one patch of floor are marked red and block the save: the plan a
 * waiter taps cannot have one tile under another.
 */
import {
  BAR_MIN, ROOM_W_MAX, ROOM_W_STEP, STOOL_OUT, barBox, clampBar, clampTable, isArranged,
  layoutFromPlans, narrowest, overlapping, roomPlan, tableSize, zoneWidth,
} from '#shared/floor'
import type { BarRotation, FloorLayout, TableShape } from '#shared/floor'
import type { TableAdmin, Zone } from '#shared/types'

const props = defineProps<{
  /** Every table of the venue, from *Stolovi*'s own read; only active ones are drawn. */
  tables: TableAdmin[]
}>()

const api = useAdminApi()
const { data: bootstrap, refresh: refreshBootstrap } = useBootstrapData()

const zone = ref<Zone>('unutra')
const ZONES = [
  { value: 'unutra', label: 'Unutra' },
  { value: 'basta', label: 'Bašta' },
]

const active = computed(() => props.tables.filter(t => t.active))

/** What the database holds. `undefined` until the bootstrap has answered. */
const saved = computed<FloorLayout | undefined>(() => bootstrap.value?.floor)

/**
 * The saved arrangement written out in full — what every screen draws right
 * now, with each table's spot spelled out whether it was stored or computed.
 */
function materialise(layout: FloorLayout): FloorLayout {
  const plans = (['unutra', 'basta'] as const).map(z => roomPlan(active.value, layout, z))
  const body = layoutFromPlans(plans, layout.bar ?? null)
  return { tables: body.tables, bar: body.bar, widths: body.widths }
}

const baseline = computed(() => (saved.value ? materialise(saved.value) : null))
const work = ref<FloorLayout | null>(null)
/**
 * The baseline `work` was copied from, as JSON. Dirty is measured against this
 * and not against the live baseline: the baseline moves by itself when the
 * table list arrives (it is empty for the first render), and a copy taken from
 * the empty one must follow it rather than count as an edit.
 */
const origin = ref<string | null>(null)

const dirty = computed(() => !!work.value && origin.value !== null
  && JSON.stringify(work.value) !== origin.value)

function adopt(layout: FloorLayout) {
  work.value = clone(layout)
  origin.value = JSON.stringify(layout)
}

/** Tables the database has no spot for — added after the room was arranged. */
const looseIds = computed(() => {
  if (!saved.value || !isArranged(saved.value)) return new Set<string>()
  return new Set(active.value.filter(t => !saved.value!.tables[t.id]).map(t => t.id))
})

/** Worth a save even with nothing dragged: never saved, or somebody new is parked. */
const needsSave = computed(() => dirty.value
  || (!!saved.value && !isArranged(saved.value))
  || looseIds.value.size > 0)

// A clean copy follows the database — a save from another laptop, a table
// added on this page. A copy with edits in it is left alone.
watch(baseline, (next) => {
  if (next && (!work.value || !dirty.value)) adopt(next)
}, { immediate: true })

function clone(layout: FloorLayout): FloorLayout {
  return JSON.parse(JSON.stringify(layout)) as FloorLayout
}

const plan = computed(() => {
  if (!work.value) return null
  const drawn = roomPlan(active.value, work.value, zone.value)
  return { ...drawn, tables: drawn.tables.map(t => ({ ...t, loose: looseIds.value.has(t.id) })) }
})

/** Overlaps in either zone — the save is refused while there are any. */
const clashes = computed(() => {
  if (!work.value) return new Set<string>()
  const hit = new Set<string>()
  for (const z of ['unutra', 'basta'] as const) {
    for (const id of overlapping(roomPlan(active.value, work.value, z))) hit.add(id)
  }
  return hit
})

const clashNames = computed(() => [...clashes.value]
  .map(id => (id === 'bar' ? 'Šank' : props.tables.find(t => t.id === id)?.name ?? '?')))

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

const selected = ref<string | null>(null)
const selectedTable = computed(() => (selected.value && selected.value !== 'bar'
  ? props.tables.find(t => t.id === selected.value) ?? null
  : null))
const selectedShape = computed<TableShape>(() =>
  (selectedTable.value && work.value?.tables[selectedTable.value.id]?.shape) || 'square')

watch(zone, () => { selected.value = null })

function onMove(id: string, x: number, y: number) {
  if (!work.value) return
  if (id === 'bar') {
    if (work.value.bar) work.value.bar = { ...work.value.bar, x, y }
    return
  }
  const spot = work.value.tables[id]
  work.value.tables[id] = { ...spot, x, y }
}

const SHAPES: ReadonlyArray<{ value: TableShape, label: string }> = [
  { value: 'square', label: 'Kvadratni' },
  { value: 'round', label: 'Okrugli' },
  { value: 'wide', label: 'Dugi' },
]

function setShape(shape: string) {
  const id = selectedTable.value?.id
  const spot = id ? work.value?.tables[id] : undefined
  if (!id || !spot || !work.value) return
  const at = clampTable(spot.x, spot.y, tableSize(shape as TableShape).w, zoneWidth(work.value, zone.value))
  work.value.tables[id] = shape === 'square'
    ? { x: at.x, y: at.y }
    : { x: at.x, y: at.y, shape: shape as TableShape }
}

/** The longest bar that fits between the walls of the room it stands in. */
const barMax = computed(() => {
  const bar = work.value?.bar
  if (!bar || !work.value) return BAR_MIN
  return zoneWidth(work.value, bar.zone) - 2 * Math.ceil(STOOL_OUT + 0.6)
})

/** The bar turns about its own middle, so it stays where the owner is looking. */
function rotateBar() {
  const bar = work.value?.bar
  if (!bar || !work.value) return
  const width = zoneWidth(work.value, bar.zone)
  const before = barBox(bar)
  const rot = (((bar.rot + 90) % 360) as BarRotation)
  const len = Math.min(bar.len, barMax.value)
  const after = barBox({ ...bar, rot, len })
  const at = clampBar(
    before.x + (before.w - after.w) / 2,
    before.y + (before.h - after.h) / 2,
    after.w,
    width,
  )
  work.value.bar = { ...bar, rot, len, ...at }
}

function resizeBar(delta: number) {
  const bar = work.value?.bar
  if (!bar || !work.value) return
  const len = Math.min(Math.max(bar.len + delta, BAR_MIN), barMax.value)
  const box = barBox({ ...bar, len })
  work.value.bar = { ...bar, len, ...clampBar(bar.x, bar.y, box.w, zoneWidth(work.value, bar.zone)) }
}

// ---------------------------------------------------------------------------
// The room's width — the owner's "can we make our caffe wider"
// ---------------------------------------------------------------------------

const width = computed(() => (work.value ? zoneWidth(work.value, zone.value) : 0))
/** *Uža* stops where a table or the bar would stand in the wall. */
const minWidth = computed(() => (plan.value ? narrowest(plan.value) : width.value))

function setWidth(delta: number) {
  if (!work.value) return
  const next = Math.min(ROOM_W_MAX, Math.max(minWidth.value, width.value + delta))
  work.value.widths = { ...work.value.widths, [zone.value]: next }
}

function undo() {
  if (baseline.value) adopt(baseline.value)
  selected.value = null
  error.value = null
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

const saving = ref(false)
const error = ref<string | null>(null)
const done = ref(false)

async function save() {
  if (!work.value) return
  if (clashes.value.size) {
    error.value = `Preklapaju se: ${clashNames.value.join(', ')}. Razmakni ih pa sačuvaj.`
    return
  }
  saving.value = true
  error.value = null
  try {
    const next = await api.saveFloor({
      tables: work.value.tables,
      bar: work.value.bar ?? null,
      // Each zone's width — *Uža / Šira* — which the first version of this
      // call left out, so a widened room came back at the default.
      ...(work.value.widths ? { widths: work.value.widths } : {}),
    })
    // Show what was stored straight away; the bootstrap refetch below is what
    // every other screen on this laptop reads.
    adopt(materialise(next))
    await refreshBootstrap()
    selected.value = null
    done.value = true
    setTimeout(() => { done.value = false }, 2500)
  } catch (err) {
    error.value = apiErrorText(err, 'Raspored nije sačuvan.')
  } finally {
    saving.value = false
  }
}

// Unsaved work is a room the owner spent minutes on: leaving asks first.
onBeforeRouteLeave(() => !dirty.value || window.confirm('Raspored nije sačuvan. Napustiti stranicu?'))

function onUnload(event: BeforeUnloadEvent) {
  if (dirty.value) event.preventDefault()
}

onMounted(() => window.addEventListener('beforeunload', onUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onUnload))

const status = computed(() => {
  if (done.value) return 'Sačuvano — telefoni ga dobiju za najviše 15 sekundi.'
  if (clashes.value.size) return `Preklapaju se: ${clashNames.value.join(', ')}.`
  if (dirty.value) return 'Izmjene nisu sačuvane.'
  if (looseIds.value.size) return 'Novi stolovi čekaju ispod sale — povuci ih na mjesto.'
  if (saved.value && !isArranged(saved.value)) return 'Raspored još nije sačuvan.'
  return 'Sačuvano.'
})

function tableLabel(id: string): string {
  return (props.tables.find(t => t.id === id)?.name ?? '').replace(/^sto\s+/i, '')
}
</script>

<template>
  <UiCard title="Raspored sale">
    <template #actions>
      <UiSeg label="Zona" :options="ZONES" :model-value="zone" @update:model-value="zone = $event as Zone" />
    </template>

    <p class="r-hint">
      Povuci sto ili šank gdje stoji u sali — na telefonu ga prvo dodirni, pa povuci.
      Ništa se ne mijenja na telefonima konobara dok ne klikneš <strong>Sačuvaj raspored</strong>.
    </p>

    <div class="r-body">
      <div class="r-stage">
        <FloorRoom
          v-if="plan"
          class="r-room"
          :plan="plan"
          editable
          :selected="selected"
          :clashes="clashes"
          @move="onMove"
          @select="selected = $event"
        >
          <template #table="{ table }">
            <span class="r-top" :class="table.shape">{{ tableLabel(table.id) }}</span>
          </template>
        </FloorRoom>
        <p v-else class="r-hint">Učitavanje…</p>
      </div>

      <aside class="r-side">
        <!-- What the selected thing can do besides being dragged. -->
        <div class="r-tools">
          <template v-if="selectedTable">
            <span class="r-tools-name">{{ selectedTable.name }}</span>
            <UiSeg
              label="Oblik stola"
              :model-value="selectedShape"
              :options="SHAPES"
              @update:model-value="setShape"
            />
          </template>

          <template v-else-if="selected === 'bar' && work?.bar">
            <span class="r-tools-name">Šank</span>
            <div class="r-tools-row">
              <UiButton small variant="soft" @click="rotateBar">Okreni</UiButton>
              <UiButton small variant="soft" :disabled="work.bar.len <= BAR_MIN" @click="resizeBar(-4)">Kraći</UiButton>
              <UiButton small variant="soft" :disabled="work.bar.len >= barMax" @click="resizeBar(4)">Duži</UiButton>
            </div>
          </template>

          <span v-else class="r-tools-hint">
            Dodirni sto da ga odabereš i promijeniš mu oblik, ili šank da ga okreneš i
            produžiš. Samo odabrani se pomjera prstom; sve ostalo pomjera stranicu.
            Na laptopu strelice pomjeraju odabrano za jedan korak.
          </span>
        </div>

        <!-- The room itself: more floor to the right, the tables where they are. -->
        <div class="r-tools">
          <span class="r-tools-name">Širina sale · {{ zone === 'basta' ? 'Bašta' : 'Unutra' }}</span>
          <div class="r-tools-row">
            <UiButton small variant="soft" :disabled="width <= minWidth" @click="setWidth(-ROOM_W_STEP)">Uža</UiButton>
            <UiButton small variant="soft" :disabled="width >= ROOM_W_MAX" @click="setWidth(ROOM_W_STEP)">Šira</UiButton>
          </div>
          <span class="r-tools-hint">
            Šira sala daje više mjesta, a stolovi su na telefonu manji.
          </span>
        </div>

        <p v-if="error" class="r-error" role="alert">{{ error }}</p>

        <p class="r-status" :class="{ warn: clashes.size || dirty, good: done }">{{ status }}</p>

        <div class="r-foot">
          <UiButton variant="ghost" :disabled="!dirty || saving" @click="undo">Poništi</UiButton>
          <UiButton
            variant="primary"
            :pending="saving"
            :disabled="!needsSave || clashes.size > 0"
            @click="save"
          >
            Sačuvaj raspored
          </UiButton>
        </div>
      </aside>
    </div>

    <!--
      On a phone, Sačuvaj is pinned over the tab bar for as long as there is
      anything to save. The owner, arranging a packed room on a phone: "When im
      done with editing, I cant scroll down to save changes" — the buttons in
      the aside sit a room's height below the tables, and the one control that
      makes the work count must never be out of reach. On a laptop the aside is
      already sticky beside the room, so the bar is not drawn there.
    -->
    <div v-if="needsSave || saving || done" class="r-bar" role="region" aria-label="Spremanje rasporeda">
      <span class="r-bar-status" :class="{ warn: clashes.size || dirty, good: done }">{{ status }}</span>
      <UiButton small variant="ghost" :disabled="!dirty || saving" @click="undo">Poništi</UiButton>
      <UiButton
        small
        variant="primary"
        :pending="saving"
        :disabled="!needsSave || clashes.size > 0"
        @click="save"
      >
        Sačuvaj
      </UiButton>
    </div>
    <div v-if="needsSave || saving || done" class="r-bar-room" aria-hidden="true" />
  </UiCard>
</template>

<style scoped>
.r-hint {
  margin: 0 0 12px;
  font-size: var(--text-label);
  color: var(--ink-2);
}

.r-body { display: grid; gap: 14px; }

.r-room {
  width: 100%;
  max-width: 580px;
  margin-inline: auto;
}

/* A laptop keeps *Sačuvaj* beside the room rather than a room's height below it. */
@media (min-width: 1024px) {
  .r-body {
    grid-template-columns: minmax(0, 580px) minmax(240px, 1fr);
    align-items: start;
    gap: 24px;
  }

  .r-side {
    position: sticky;
    top: 16px;
  }
}

.r-side { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

/* The editor's table top: the number and nothing else — this is where a table
   stands, not what is on it. */
.r-top {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border-radius: calc(var(--u) * 3.2);
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-raise);
  font-family: var(--font-display);
  font-size: clamp(15px, calc(var(--u) * 5.6), 24px);
  font-weight: 700;
  color: var(--ink);
}

.r-top.round { border-radius: 50%; }

.r-tools {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  min-height: 56px;
  padding: 12px 14px;
  border-radius: var(--radius-field);
  border: 1px solid var(--line);
}

.r-tools-name {
  font-weight: 600;
  color: var(--ink);
}

.r-tools-row { display: flex; flex-wrap: wrap; gap: 6px; }

.r-tools-hint { font-size: var(--text-label); color: var(--muted); }

.r-error {
  margin: 0;
  padding: 10px 14px;
  border-radius: var(--radius-field);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: var(--text-label);
  font-weight: 500;
}

.r-status {
  margin: 0;
  font-size: var(--text-label);
  color: var(--muted);
}

.r-status.warn { color: var(--warn); }
.r-status.good { color: var(--good); }

.r-foot {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

/* ---- the phone's save bar ---------------------------------------------- */

.r-bar,
.r-bar-room { display: none; }

@media (max-width: 1023px) {
  .r-bar {
    position: fixed;
    left: 0;
    right: 0;
    /* Directly over the admin tab bar (60 px and the home indicator). */
    bottom: calc(60px + env(safe-area-inset-bottom));
    z-index: 21;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    background: var(--surface);
    border-top: 1px solid var(--line);
    box-shadow: var(--shadow-pop);
  }

  .r-bar-status {
    flex: 1;
    min-width: 0;
    font-size: var(--text-micro);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .r-bar-status.warn { color: var(--warn); }
  .r-bar-status.good { color: var(--good); }

  /* The bar's own height, so it never covers the end of the page. */
  .r-bar-room { display: block; height: 64px; }
}
</style>
