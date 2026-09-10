<script setup lang="ts">
/**
 * *Stolovi i zone* — the floor plan the waiter taps.
 *
 * The numbers are typed and the plan above redraws as they change, so a table
 * moved to the wrong square is visible before anybody carries a tray to it. No
 * drag-and-drop in Phase 2.
 *
 * A table with guests sitting at it cannot be switched off: the server answers
 * 409 `TABLE_HAS_OPEN_TAB` and the sentence explains what to do about it, rather
 * than the screen quietly showing a switch that flips back.
 */
import { bsCompare } from '#shared/collate'
import type { TableAdmin, Zone } from '#shared/types'
import type { CreateTableBody, UpdateTableBody } from '#shared/schemas'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Stolovi' })

const api = useAdminApi()

const tables = ref<TableAdmin[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const busyId = ref<string | null>(null)
const activeId = ref<string | null>(null)

const zone = ref<Zone>('unutra')

const newOpen = ref(false)
const newPending = ref(false)
const newError = ref<string | null>(null)

async function load() {
  try {
    tables.value = await api.getTables()
    error.value = null
  } catch (err) {
    error.value = apiErrorText(err, 'Stolovi se nisu učitali.')
  } finally {
    loading.value = false
  }
}

onMounted(() => { void load() })

// `table` moves when a tab opens or closes, `menu` when the floor plan itself
// is edited — from another laptop, or from this one.
useAdminChanges({
  onEntity: (entity) => { if (entity === 'menu' || entity === 'table') void load() },
})

const inZone = computed(() => tables.value
  .filter(table => table.zone === zone.value)
  .slice()
  .sort((a, b) => a.sort - b.sort || bsCompare(a.name, b.name)))

const counts = computed(() => ({
  unutra: tables.value.filter(table => table.zone === 'unutra').length,
  basta: tables.value.filter(table => table.zone === 'basta').length,
}))

const columns = [
  { key: 'sto', label: 'Sto' },
  { key: 'zona', label: 'Zona', width: '130px' },
  { key: 'kolona', label: 'Kolona', align: 'r' as const, width: '96px' },
  { key: 'red', label: 'Red', align: 'r' as const, width: '96px' },
  { key: 'sort', label: 'Sortiranje', align: 'r' as const, width: '110px' },
  { key: 'aktivan', label: 'Aktivan', width: '100px' },
  { key: 'stanje', label: 'Stanje', width: '120px' },
]

async function patch(table: TableAdmin, body: UpdateTableBody) {
  busyId.value = table.id
  try {
    const fresh = await api.updateTable(table.id, body)
    const index = tables.value.findIndex(row => row.id === table.id)
    if (index >= 0) tables.value[index] = fresh
    error.value = null
  } catch (err) {
    // Re-read first, so the switch goes back to what the database actually has
    // — then set the sentence, because `load()` clears it on a good read.
    await load()
    error.value = apiErrorText(err, 'Izmjena nije snimljena.')
  } finally {
    busyId.value = null
  }
}

async function create(body: CreateTableBody) {
  newPending.value = true
  try {
    await api.createTable(body)
    newOpen.value = false
    await load()
  } catch (err) {
    newError.value = apiErrorText(err, 'Sto nije dodan.')
  } finally {
    newPending.value = false
  }
}
</script>

<template>
  <PostavkePage
    title="Stolovi i zone"
    sub="Raspored stolova kakav konobar vidi na telefonu"
    :error="error"
  >
    <template #actions>
      <UiButton variant="primary" @click="newError = null; newOpen = true">Novi sto</UiButton>
    </template>

    <UiSeg
      class="p-zone"
      :model-value="zone"
      label="Zona"
      :options="[
        { value: 'unutra', label: `Unutra ${counts.unutra}` },
        { value: 'basta', label: `Bašta ${counts.basta}` },
      ]"
      @update:model-value="value => zone = value as Zone"
    />

    <UiCard title="Raspored">
      <PostavkeTableGrid
        :tables="tables"
        :zone="zone"
        :active-id="activeId"
        @pick="id => activeId = id"
      />
      <p class="p-legend">
        Isprekidan okvir je ugašen sto, žuto je sto sa otvorenim računom, crveno
        znači da dva stola stoje na istom polju.
      </p>
    </UiCard>

    <UiCard title="Stolovi" :count="inZone.length">
      <UiTable :columns="columns" :loading="loading" empty="Nema stolova u ovoj zoni.">
        <tr
          v-for="table in inZone"
          :key="table.id"
          :class="{ off: !table.active, on: activeId === table.id }"
          @focusin="activeId = table.id"
        >
          <td>
            <strong>{{ table.name }}</strong>
            <small v-if="table.grp" class="p-grp">{{ table.grp }}</small>
          </td>
          <td>
            <PostavkeSelect
              :model-value="table.zone"
              :label="`Zona, ${table.name}`"
              :disabled="busyId === table.id"
              :options="[
                { value: 'unutra', label: 'Unutra' },
                { value: 'basta', label: 'Bašta' },
              ]"
              @update:model-value="value => patch(table, { zone: value as Zone })"
            />
          </td>
          <td class="r">
            <PostavkeNum
              :model-value="table.col"
              kind="int"
              :label="`Kolona, ${table.name}`"
              width="72px"
              :pending="busyId === table.id"
              @commit="value => value !== null && patch(table, { col: value })"
            />
          </td>
          <td class="r">
            <PostavkeNum
              :model-value="table.row"
              kind="int"
              :label="`Red, ${table.name}`"
              width="72px"
              :pending="busyId === table.id"
              @commit="value => value !== null && patch(table, { row: value })"
            />
          </td>
          <td class="r">
            <PostavkeNum
              :model-value="table.sort"
              kind="int"
              :label="`Sortiranje, ${table.name}`"
              width="80px"
              :pending="busyId === table.id"
              @commit="value => value !== null && patch(table, { sort: value })"
            />
          </td>
          <td>
            <PostavkeToggle
              :model-value="table.active"
              :label="`Aktivan, ${table.name}`"
              :disabled="busyId === table.id"
              @update:model-value="value => patch(table, { active: value })"
            />
          </td>
          <td>
            <UiPill v-if="table.has_open_tab" tone="warn">otvoren račun</UiPill>
            <UiPill v-else-if="!table.active" tone="neutral">ugašen</UiPill>
            <UiPill v-else tone="good">slobodan</UiPill>
          </td>
        </tr>
      </UiTable>
    </UiCard>

    <PostavkeTableSheet
      :open="newOpen"
      :zone="zone"
      :pending="newPending"
      :error="newError"
      @close="newOpen = false"
      @save="create"
    />
  </PostavkePage>
</template>

<style scoped>
/* The page is a flex column, which would stretch the inline segment to the
   full width; it keeps its own size instead. */
.p-zone { align-self: flex-start; }

.off td { opacity: 0.6; }
.on td:first-child { box-shadow: inset 3px 0 0 var(--accent); }
.p-grp { display: block; font-size: var(--text-caption); color: var(--muted); }
.p-legend { margin: 0; font-size: var(--text-micro); color: var(--muted); }
</style>
