<script setup lang="ts">
/**
 * *Šabloni smjena* — the two or three shifts a week is built out of.
 *
 * **A template is a plan, not a ledger.** It has no triggers behind it and it
 * may be edited freely — but editing one never rewrites what anybody has already
 * worked: `roster_assignments` copies `start_time` and `end_time` at insert, the
 * way a price is snapshotted at lock. So a *Večernja* moved from 15–00 to 16–01
 * today leaves last Friday's rows on 15–00, and the grid shows
 * "16–01 (staro 15–00)" for the week that straddles the change. The sentence at
 * the bottom of this page says exactly that, because it is the one thing about
 * this screen that is surprising.
 *
 * `end_time <= start_time` means the shift ends the next day — *Večernja*
 * 16:00–01:00 is nine hours, on every date of the year including the two the
 * clocks change. Rostering is nominal on purpose (PHASE4 §2.7): there is no
 * timezone in this screen and none in the hours it prints.
 */
import { plannedHours } from '#shared/dates'
import type { ShiftTemplateView } from '#shared/types'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Šabloni smjena' })

const api = useAdminApi()

const rows = ref<ShiftTemplateView[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const busy = ref(false)

async function load() {
  try {
    rows.value = await api.getShiftTemplates()
    error.value = null
  } catch (err) {
    error.value = apiErrorText(err, 'Šabloni se nisu učitali.')
  } finally {
    loading.value = false
  }
}

onMounted(load)

useAdminChanges({ onEntity: (entity) => { if (entity === 'roster') void load() } })

// -- the sheet --------------------------------------------------------------

const editing = ref<ShiftTemplateView | null>(null)
const adding = ref(false)
const form = reactive({ name: '', start_time: '16:00', end_time: '01:00', sort: 0 })
const formError = ref<string | null>(null)

const open = computed(() => adding.value || !!editing.value)
const HHMM = /^\d{2}:\d{2}$/

const valid = computed(() =>
  form.name.trim().length > 0 && HHMM.test(form.start_time) && HHMM.test(form.end_time))

const previewH = computed(() =>
  (valid.value ? hoursBs(plannedHours(form.start_time, form.end_time)) : ''))

function startAdd() {
  adding.value = true
  editing.value = null
  formError.value = null
  Object.assign(form, { name: '', start_time: '16:00', end_time: '01:00', sort: rows.value.length })
}

function startEdit(row: ShiftTemplateView) {
  editing.value = row
  adding.value = false
  formError.value = null
  Object.assign(form, {
    name: row.name, start_time: row.start_time, end_time: row.end_time, sort: row.sort,
  })
}

function close() {
  adding.value = false
  editing.value = null
}

async function save() {
  if (!valid.value) return
  busy.value = true
  formError.value = null
  try {
    const body = {
      name: form.name.trim(),
      start_time: form.start_time,
      end_time: form.end_time,
      sort: form.sort,
    }
    if (editing.value) await api.updateShiftTemplate(editing.value.id, body)
    else await api.createShiftTemplate(body)
    close()
    await load()
  } catch (err) {
    formError.value = apiErrorText(err, 'Nije snimljeno.')
  } finally {
    busy.value = false
  }
}

/**
 * *Deaktiviraj* — the template stops being offered on future weeks and keeps
 * every row that already carries it. There is no delete: a week that has been
 * published names this template, and a name that disappears takes the history of
 * who worked it with it.
 */
async function setActive(row: ShiftTemplateView, active: boolean) {
  busy.value = true
  error.value = null
  try {
    await api.updateShiftTemplate(row.id, { active })
    await load()
  } catch (err) {
    error.value = apiErrorText(err, 'Nije snimljeno.')
  } finally {
    busy.value = false
  }
}

const columns = [
  { key: 'name', label: 'Naziv' },
  { key: 'span', label: 'Vrijeme' },
  { key: 'h', label: 'Sati', align: 'r' as const },
  { key: 'state', label: 'Stanje' },
  { key: 'act', label: '', align: 'r' as const },
]
</script>

<template>
  <PostavkePage
    title="Šabloni smjena"
    sub="Smjene od kojih se slaže sedmica"
    :error="error"
  >
    <template #actions>
      <UiButton variant="primary" @click="startAdd">Novi šablon</UiButton>
    </template>

    <UiCard title="Šabloni" :count="rows.length">
      <p v-if="!loading && !rows.length" class="s-quiet">
        Nema nijednog šablona. Bez njega raspored nema redove.
      </p>

      <UiTable v-else :columns="columns" :loading="loading">
        <tr v-for="row in rows" :key="row.id">
          <td><strong>{{ row.name }}</strong></td>
          <td class="s-n">{{ timeSpanBs(row.start_time, row.end_time) }}</td>
          <td class="s-n">{{ hoursBs(plannedHours(row.start_time, row.end_time)) }}</td>
          <td>
            <UiPill :tone="row.active ? 'good' : 'neutral'">
              {{ row.active ? 'aktivan' : 'neaktivan' }}
            </UiPill>
          </td>
          <td class="s-act">
            <UiButton small variant="ghost" @click="startEdit(row)">Izmijeni</UiButton>
            <UiButton small variant="ghost" :pending="busy" @click="setActive(row, !row.active)">
              {{ row.active ? 'Deaktiviraj' : 'Aktiviraj' }}
            </UiButton>
          </td>
        </tr>
      </UiTable>

      <p class="s-foot">
        Izmjena šablona ne mijenja već upisane smjene — one zadržavaju vrijeme s
        kojim su upisane, pa raspored te sedmice pokaže i staro vrijeme.
        Deaktiviran šablon nestaje iz budućih sedmica, a stare ostaju kakve jesu.
      </p>
    </UiCard>

    <UiSheet
      :open="open"
      :title="editing ? `Izmijeni · ${editing.name}` : 'Novi šablon smjene'"
      action="Snimi"
      :pending="busy"
      @close="close"
      @confirm="save"
    >
      <div class="s-form">
        <UiField v-model="form.name" label="Naziv" placeholder="Večernja" />

        <div class="s-times">
          <label class="s-time">
            <span>Počinje</span>
            <input v-model="form.start_time" type="time" step="300">
          </label>
          <label class="s-time">
            <span>Završava</span>
            <input v-model="form.end_time" type="time" step="300">
          </label>
        </div>

        <p class="s-quiet">
          Trajanje: <strong>{{ previewH || '—' }}</strong>. Ako je kraj prije
          početka, smjena se završava sutradan.
        </p>

        <p v-if="formError" class="s-error" role="alert">{{ formError }}</p>
      </div>
    </UiSheet>
  </PostavkePage>
</template>

<style scoped>
.s-quiet { margin: 0; color: var(--muted); font-size: var(--text-micro); }
.s-error { margin: 0; color: var(--danger); font-weight: 500; }
.s-foot { margin: 0; color: var(--muted); font-size: var(--text-micro); }
.s-n { font-variant-numeric: tabular-nums; white-space: nowrap; }
.s-act { white-space: nowrap; }
.s-act :deep(.a-btn) + :deep(.a-btn) { margin-left: 6px; }

.s-form { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.s-times { display: flex; gap: 10px; }

.s-time { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
.s-time span { font-size: var(--text-micro); color: var(--ink-2); font-weight: 600; }

.s-time input {
  height: 44px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--field-bg);
  color: var(--ink);
  font: inherit;
  padding: 0 10px;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 1023px) {
  .s-act :deep(.a-btn) { height: 44px; }
}
</style>
