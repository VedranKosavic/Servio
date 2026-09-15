<script setup lang="ts">
/**
 * `/admin/kontrola/sabloni` — *Šabloni smjena*, the shifts a week is built out of.
 *
 * **A template is a plan, not a ledger.** It may be renamed, re-timed or switched
 * off freely, because editing one never rewrites a published week:
 * `roster_assignments` copies `start_time` and `end_time` at insert, the way a
 * price is snapshotted at lock, and *Raspored* prints "16–01 (staro 15–00)" for
 * a week that kept the old hours. The sentence under the list says so, because
 * it is the one surprising thing about this screen.
 *
 * **No delete.** A published week names the template; *Deaktiviraj* takes it off
 * future weeks and leaves every existing row readable.
 *
 * `end_time <= start_time` means the shift ends the next day. Rostering is
 * nominal (PHASE4 §2.7): no timezone here and none in the hours printed.
 *
 * A list at both widths rather than a table: there are two or three rows, and a
 * row that wraps its buttons under itself never scrolls sideways at 375 px.
 */
import { plannedHours } from '#shared/dates'
import type { ShiftTemplateView } from '#shared/types'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Šabloni smjena' })

const api = useAdminApi()

const rows = ref<ShiftTemplateView[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
/** The id whose *Aktiviraj/Deaktiviraj* is in flight. */
const rowBusy = ref<string | null>(null)

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

onMounted(() => { void load() })

// `createTemplate` / `updateTemplate` bump `roster`, the same entity the week does.
useAdminChanges({ onEntity: (entity) => { if (entity === 'roster') void load() } })

// -- the sheet --------------------------------------------------------------

const editing = ref<ShiftTemplateView | null>(null)
const adding = ref(false)
const form = reactive({ name: '', start_time: '15:00', end_time: '23:00', sort: 0 as number | null })
const formError = ref<string | null>(null)
const saving = ref(false)

const open = computed(() => adding.value || editing.value !== null)
const HHMM = /^\d{2}:\d{2}$/

/** Checked here so the owner reads the reason before a round trip; the server checks it too. */
const nameTaken = computed(() => {
  const name = form.name.trim().toLocaleLowerCase('bs')
  return rows.value.some(row => row.id !== editing.value?.id && row.name.toLocaleLowerCase('bs') === name)
})

const valid = computed(() =>
  form.name.trim().length > 0
  && form.name.trim().length <= 40
  && HHMM.test(form.start_time)
  && HHMM.test(form.end_time)
  && form.sort !== null && form.sort >= 0 && form.sort <= 999
  && !nameTaken.value)

const preview = computed(() =>
  (HHMM.test(form.start_time) && HHMM.test(form.end_time)
    ? hoursBs(plannedHours(form.start_time, form.end_time))
    : '—'))

const nextDay = computed(() =>
  HHMM.test(form.start_time) && HHMM.test(form.end_time) && form.end_time <= form.start_time)

function startAdd() {
  editing.value = null
  adding.value = true
  formError.value = null
  const lastSort = rows.value.reduce((max, row) => Math.max(max, row.sort), -1)
  Object.assign(form, { name: '', start_time: '15:00', end_time: '23:00', sort: lastSort + 1 })
}

function startEdit(row: ShiftTemplateView) {
  adding.value = false
  editing.value = row
  formError.value = null
  Object.assign(form, { name: row.name, start_time: row.start_time, end_time: row.end_time, sort: row.sort })
}

function close() {
  adding.value = false
  editing.value = null
}

async function save() {
  if (!valid.value) {
    formError.value = nameTaken.value
      ? 'Šablon s tim nazivom već postoji.'
      : 'Upiši naziv, početak i kraj smjene.'
    return
  }
  saving.value = true
  formError.value = null
  try {
    const body = {
      name: form.name.trim(),
      start_time: form.start_time,
      end_time: form.end_time,
      sort: form.sort ?? 0,
    }
    if (editing.value) await api.updateShiftTemplate(editing.value.id, body)
    else await api.createShiftTemplate(body)
    close()
    await load()
  } catch (err) {
    formError.value = apiErrorText(err, 'Šablon nije snimljen.')
  } finally {
    saving.value = false
  }
}

async function setActive(row: ShiftTemplateView, active: boolean) {
  rowBusy.value = row.id
  try {
    await api.updateShiftTemplate(row.id, { active })
    await load()
  } catch (err) {
    error.value = apiErrorText(err, active ? 'Šablon nije aktiviran.' : 'Šablon nije deaktiviran.')
  } finally {
    rowBusy.value = null
  }
}
</script>

<template>
  <div class="a-page">
    <UiPageHead
      eyebrow="Kontrolna ploča"
      title="Šabloni smjena"
      sub="Smjene od kojih se gradi raspored"
    >
      <template #actions>
        <UiButton variant="primary" @click="startAdd">Novi šablon</UiButton>
      </template>
    </UiPageHead>

    <p v-if="error" class="s-page-error" role="alert">{{ error }}</p>

    <UiCard title="Šabloni" :count="loading ? undefined : rows.length">
      <template v-if="loading">
        <p class="s-skeleton" />
        <p class="s-skeleton" />
      </template>

      <p v-else-if="!rows.length" class="s-quiet">
        Nema nijednog šablona. Bez njega raspored nema redove.
      </p>

      <ul v-else class="s-list">
        <li v-for="row in rows" :key="row.id" class="s-row" :class="{ off: !row.active }">
          <span class="s-text">
            <strong>{{ row.name }}</strong>
            <small class="num">
              {{ row.start_time }}–{{ row.end_time }} · {{ hoursBs(plannedHours(row.start_time, row.end_time)) }}
            </small>
          </span>
          <UiPill :tone="row.active ? 'good' : 'neutral'">
            {{ row.active ? 'aktivan' : 'neaktivan' }}
          </UiPill>
          <span class="s-actions">
            <UiButton small variant="ghost" @click="startEdit(row)">Izmijeni</UiButton>
            <UiButton
              small
              variant="soft"
              :pending="rowBusy === row.id"
              :disabled="rowBusy !== null && rowBusy !== row.id"
              @click="setActive(row, !row.active)"
            >
              {{ row.active ? 'Deaktiviraj' : 'Aktiviraj' }}
            </UiButton>
          </span>
        </li>
      </ul>

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
      :pending="saving"
      @close="close"
      @confirm="save"
    >
      <div class="s-form">
        <UiField
          :model-value="form.name"
          label="Naziv"
          placeholder="Druga smjena"
          :error="nameTaken ? 'Šablon s tim nazivom već postoji.' : undefined"
          @update:model-value="value => form.name = String(value ?? '')"
        />

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
          Trajanje: <strong class="num">{{ preview }}</strong>.
          <template v-if="nextDay">Smjena se završava sutradan.</template>
        </p>

        <PostavkeNumField
          label="Redoslijed"
          :model-value="form.sort"
          kind="int"
          hint="Manji broj stoji više u rasporedu."
          @input="value => form.sort = value"
          @commit="value => form.sort = value"
        />

        <p v-if="formError" class="s-error" role="alert">{{ formError }}</p>
      </div>
    </UiSheet>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

.s-page-error {
  margin: 0;
  padding: 10px 14px;
  border-radius: var(--radius-field);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: var(--text-label);
  font-weight: 500;
}

.s-skeleton {
  margin: 0 0 10px;
  height: 12px;
  border-radius: 6px;
  background: var(--surface-2);
}

.s-list { list-style: none; margin: 0; padding: 0; }

/* The *Kontrolna ploča* row: a 56 px target, the name talking. The buttons wrap
   under the text on a narrow phone instead of pushing the row sideways. */
.s-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  min-height: 56px;
  padding: 10px 0;
  border-bottom: 1px solid var(--surface-2);
}

.s-row:last-child { border-bottom: 0; }
.s-row.off .s-text { opacity: 0.6; }

.s-text { flex: 1 1 160px; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.s-text strong { font-size: var(--text-body); font-weight: 600; }
.s-text small { color: var(--muted); font-size: var(--text-micro); }

.s-actions { display: inline-flex; gap: 6px; }

.s-quiet { margin: 0; color: var(--muted); font-size: var(--text-micro); }
.s-foot { margin: 12px 0 0; color: var(--muted); font-size: var(--text-micro); }
.s-error { margin: 0; color: var(--danger); font-weight: 500; }

.s-form { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.s-times { display: flex; gap: 10px; }

.s-time { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
.s-time span { font-size: var(--text-micro); color: var(--ink-2); font-weight: 600; }

.s-time input {
  height: var(--tap);
  width: 100%;
  min-width: 0;
  border-radius: var(--radius-field);
  border: 1px solid var(--line);
  background: var(--field-bg);
  color: var(--ink);
  font: inherit;
  padding: 0 10px;
  font-variant-numeric: tabular-nums;
}

.s-time input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

@media (max-width: 1023px) {
  .s-actions { flex: 1 1 100%; }
  .s-actions :deep(.a-btn) { flex: 1; }
}
</style>
