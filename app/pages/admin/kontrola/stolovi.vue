<script setup lang="ts">
/**
 * *Stolovi* — the tables and the two zones, as the waiter's plan draws them.
 *
 * The plan is data: `FloorPlan.vue` and *Puls* both draw one stack per
 * `col`, ordered by `row`, with a `grp` boxed under its column. So a table
 * added here appears on every phone with no code change; this screen only lists
 * the rows in that same order (`stoloviByZone`) and marks two active tables
 * standing on one square, which the plan would quietly stack.
 *
 * **How a change reaches the phones.** `POST`/`PATCH /api/admin/tables` bump
 * both `table` and `menu`. The waiter's poll sees `menu_version` move and
 * refetches `/api/bootstrap`, which carries the names and squares; `table`
 * carries who sits where. One poll, at most 15 s.
 *
 * **Two layouts, one page**, gated exactly as *Osoblje* is: `useMounted` keeps
 * the first client render identical to the server's (which has no viewport),
 * then a phone swaps the table for a list whose rows open the sheet.
 */
import type { TableAdmin, Zone } from '#shared/types'
import type { CreateTableBody, UpdateTableBody } from '#shared/schemas'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Stolovi' })

const api = useAdminApi()

const mounted = useMounted()
const narrow = useMediaQuery('(max-width: 1023px)')
const isPhone = computed(() => mounted.value && narrow.value)

const tables = ref<TableAdmin[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
/** The row whose switch is being written, on the laptop. */
const busyId = ref<string | null>(null)

/** The table in the sheet, by id — a write replaces the object in `tables`. */
const editId = ref<string | null>(null)
const creating = ref(false)
const newZone = ref<Zone>('unutra')
const sheetPending = ref(false)
const sheetError = ref<string | null>(null)

const editing = computed(() => tables.value.find(t => t.id === editId.value) ?? null)
const sheetOpen = computed(() => creating.value || editing.value !== null)

const zones = computed(() => stoloviByZone(tables.value))
const clashes = computed(() => stoloviClashes(tables.value))
const draft = computed(() => stoloviNextDraft(tables.value, newZone.value))

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

// `table` moves when guests sit down or leave (the *zauzet* pill), `menu` when a
// table itself is edited — from another laptop, or from this one.
useAdminChanges({
  onEntity: (entity) => { if (entity === 'table' || entity === 'menu') void load() },
})

const columns = [
  { key: 'sto', label: 'Sto' },
  { key: 'mjesto', label: 'Mjesto na planu' },
  { key: 'redoslijed', label: 'Redoslijed', align: 'r' as const, width: '110px' },
  { key: 'aktivan', label: 'Aktivan', width: '100px' },
  { key: 'stanje', label: 'Stanje', width: '130px' },
  { key: 'akcije', label: '', align: 'r' as const, width: '120px' },
]

function openNew(zone: Zone) {
  newZone.value = zone
  editId.value = null
  sheetError.value = null
  creating.value = true
}

function openEdit(table: TableAdmin) {
  creating.value = false
  sheetError.value = null
  editId.value = table.id
}

function closeSheet() {
  creating.value = false
  editId.value = null
}

async function create(body: CreateTableBody) {
  sheetPending.value = true
  try {
    await api.createTable(body)
    closeSheet()
    await load()
  } catch (err) {
    sheetError.value = apiErrorText(err, 'Sto nije dodan.')
  } finally {
    sheetPending.value = false
  }
}

async function update(id: string, patch: UpdateTableBody) {
  sheetPending.value = true
  try {
    await api.updateTable(id, patch)
    closeSheet()
    await load()
  } catch (err) {
    sheetError.value = apiErrorText(err, 'Izmjena nije snimljena.')
  } finally {
    sheetPending.value = false
  }
}

/** The laptop's inline switch: the same `PATCH`, so the same server guard. */
async function setActive(table: TableAdmin, active: boolean) {
  busyId.value = table.id
  try {
    await api.updateTable(table.id, { active })
    await load()
  } catch (err) {
    // Re-read first so the switch shows what the database has, then say why —
    // `load()` clears the sentence on a good read.
    await load()
    error.value = apiErrorText(err, active ? 'Sto nije vraćen.' : 'Sto nije ugašen.')
  } finally {
    busyId.value = null
  }
}
</script>

<template>
  <div class="a-page">
    <UiPageHead eyebrow="Kontrolna ploča" title="Stolovi" sub="Stolovi i zone kako ih konobar vidi na planu">
      <template #actions>
        <UiButton variant="primary" @click="openNew('unutra')">Novi sto</UiButton>
      </template>
    </UiPageHead>

    <p v-if="error" class="s-error" role="alert">{{ error }}</p>

    <!-- Where each table stands: dragged here, saved once, drawn by every plan. -->
    <StoloviRaspored :tables="tables" />

    <template v-for="group in zones" :key="group.zone">
      <!-- ---- the phone ----------------------------------------------- -->
      <section v-if="isPhone" class="s-group">
        <h2 class="s-group-head">
          <span>{{ group.label }}</span>
          <span class="s-group-n num">{{ group.tables.length }}</span>
          <UiButton class="s-group-add" small variant="soft" @click="openNew(group.zone)">
            Dodaj
          </UiButton>
        </h2>

        <div v-if="loading" class="s-card s-skel" aria-hidden="true">
          <span v-for="n in 3" :key="n" class="s-skel-bar" />
        </div>
        <div v-else-if="group.tables.length" class="s-card">
          <button
            v-for="table in group.tables"
            :key="table.id"
            type="button"
            class="s-row"
            :class="{ off: !table.active }"
            @click="openEdit(table)"
          >
            <span class="s-text">
              <span class="s-name">{{ table.name }}</span>
              <span class="s-spot">{{ stoloviSpotBs(table) }}</span>
            </span>
            <span class="s-marks">
              <UiPill v-if="clashes.has(table.id)" tone="bad">isto polje</UiPill>
              <UiPill v-if="!table.active" tone="neutral">ugašen</UiPill>
              <UiPill v-else-if="table.has_open_tab" tone="warn">zauzet</UiPill>
            </span>
            <UiIcon class="s-chev" name="chevron-right" :size="20" />
          </button>
        </div>
        <p v-else class="s-empty">Nema stolova u ovoj zoni.</p>
      </section>

      <!-- ---- the laptop ---------------------------------------------- -->
      <UiCard v-else :title="group.label" :count="group.tables.length" flush>
        <template #actions>
          <UiButton small variant="soft" @click="openNew(group.zone)">Dodaj sto</UiButton>
        </template>
        <UiTable :columns="columns" :loading="loading" empty="Nema stolova u ovoj zoni.">
          <tr v-for="table in group.tables" :key="table.id" :class="{ off: !table.active }">
            <td><strong>{{ table.name }}</strong></td>
            <td>
              {{ stoloviSpotBs(table) }}
              <UiPill v-if="clashes.has(table.id)" tone="bad">isto polje</UiPill>
            </td>
            <td class="r">{{ table.sort }}</td>
            <td>
              <PostavkeToggle
                :model-value="table.active"
                :label="`Aktivan, ${table.name}`"
                :disabled="busyId === table.id || (table.active && table.has_open_tab)"
                @update:model-value="value => setActive(table, value)"
              />
            </td>
            <td>
              <UiPill v-if="!table.active" tone="neutral">ugašen</UiPill>
              <UiPill v-else-if="table.has_open_tab" tone="warn">zauzet</UiPill>
              <UiPill v-else tone="good">slobodan</UiPill>
            </td>
            <td class="r">
              <UiButton small variant="ghost" @click="openEdit(table)">Izmijeni</UiButton>
            </td>
          </tr>
        </UiTable>
      </UiCard>
    </template>

    <p class="s-note">
      Mjesto stola na planu mijenjaš povlačenjem u Rasporedu sale. Kolona i red
      određuju samo gdje se novi sto pojavi dok ga ne povučeš i sačuvaš.
      Sto se ne briše: ugašen sto nestaje s plana, a stare ture ostaju. Zauzet
      sto se ne može ugasiti. Izmjena stiže na telefone za najviše 15 sekundi.
    </p>

    <PostavkeStoSheet
      :open="sheetOpen"
      :table="editing"
      :draft="draft"
      :pending="sheetPending"
      :error="sheetError"
      @close="closeSheet"
      @create="create"
      @update="update"
    />
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

/* A wide table scrolls inside its own box and never drags the page sideways
   (see the same rule in `PostavkePage.vue`). */
.a-page :deep(.a-table-wrap) { contain: paint; }

.s-error {
  margin: 0;
  padding: 10px 14px;
  border-radius: var(--radius-field);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: var(--text-label);
  font-weight: 500;
}

.off td { opacity: 0.6; }

.s-note { margin: 0; font-size: var(--text-micro); color: var(--muted); }

/* ---- the phone list: the same shapes as `PostavkeOsobljeList` ---- */
.s-group { display: flex; flex-direction: column; gap: 6px; min-width: 0; }

.s-group-head {
  position: sticky;
  top: 0;
  z-index: 2;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: var(--tap);
  padding: 6px 2px;
  background: var(--bg);
  font-size: var(--text-section);
  font-weight: 600;
  color: var(--ink);
}

.s-group-n { font-size: var(--text-label); font-weight: 500; color: var(--muted); }
.s-group-add { margin-left: auto; }

.s-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  overflow: hidden;
  min-width: 0;
}

.s-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: var(--tap);
  padding: 10px 6px 10px 16px;
  border: 0;
  border-bottom: 1px solid var(--line-soft);
  background: transparent;
  font: inherit;
  color: var(--ink);
  text-align: left;
  cursor: pointer;
}

.s-row:last-child { border-bottom: 0; }
.s-row:active { background: var(--surface-2); }
.s-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

.s-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }

.s-name {
  font-size: var(--text-body);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.s-row.off .s-name { color: var(--ink-2); }
.s-spot { font-size: var(--text-micro); color: var(--muted); }
.s-marks { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; }
.s-chev { color: var(--muted); }

.s-skel { display: flex; flex-direction: column; gap: 18px; padding: 18px 16px; }

.s-skel-bar {
  display: block;
  height: 10px;
  width: 40%;
  border-radius: var(--radius-chip);
  background: var(--surface-2);
}

.s-empty {
  margin: 0;
  padding: 22px 16px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-card);
  color: var(--muted);
  font-size: var(--text-body);
  text-align: center;
}
</style>
