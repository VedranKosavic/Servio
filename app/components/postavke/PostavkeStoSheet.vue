<script setup lang="ts">
/**
 * One table, new or being edited — at both widths.
 *
 * The four numbers that place it are the ones `FloorPlan.vue` reads: the zone,
 * the column (one vertical stack per column), the row (the order inside that
 * stack) and the group (its own dashed box under the column — today *vip*).
 * *Redoslijed* is not a place on the plan; it is the order of the list the
 * waiter picks from in *Premjesti*.
 *
 * **Nothing is deleted.** A table stands on old rounds by id, so the way out is
 * *Aktivan* off — and the server refuses that while guests sit there (409
 * `TABLE_HAS_OPEN_TAB`), which the switch says before it is tried.
 */
import type { TableAdmin, Zone } from '#shared/types'
import type { CreateTableBody, UpdateTableBody } from '#shared/schemas'
import type { StoloviDraft } from '~/utils/stolovi'

const props = defineProps<{
  open: boolean
  /** `null` means *Novi sto*. */
  table: TableAdmin | null
  /** What a new table is prefilled with. */
  draft: StoloviDraft
  pending: boolean
  error: string | null
}>()

const emit = defineEmits<{
  close: []
  create: [body: CreateTableBody]
  update: [id: string, patch: UpdateTableBody]
}>()

const name = ref('')
const zone = ref<Zone>('unutra')
const col = ref<number | null>(1)
const row = ref<number | null>(1)
const grp = ref('')
const sort = ref<number | null>(0)
const active = ref(true)

watch(() => [props.open, props.table?.id], () => {
  if (!props.open) return
  const t = props.table
  name.value = t?.name ?? props.draft.name
  zone.value = t?.zone ?? props.draft.zone
  col.value = t?.col ?? props.draft.col
  row.value = t?.row ?? props.draft.row
  grp.value = t?.grp ?? ''
  sort.value = t?.sort ?? 0
  active.value = t?.active ?? true
}, { immediate: true })

/** The schema's own bounds (`createTableBody`), said before the server does. */
function spotError(value: number | null): string | null {
  if (value === null) return 'Upiši broj.'
  return Number.isInteger(value) && value >= 1 && value <= 12 ? null : 'Od 1 do 12.'
}

const nameError = computed(() => (name.value.trim().length > 20 ? 'Najviše 20 znakova.' : null))
const colError = computed(() => spotError(col.value))
const rowError = computed(() => spotError(row.value))
const grpError = computed(() => (grp.value.trim().length > 20 ? 'Najviše 20 znakova.' : null))
const sortError = computed(() => {
  if (sort.value === null) return null
  return Number.isInteger(sort.value) && sort.value >= 0 && sort.value <= 9999
    ? null
    : 'Od 0 do 9999.'
})

const canSave = computed(() => name.value.trim() !== ''
  && !nameError.value && !colError.value && !rowError.value
  && !grpError.value && !sortError.value)

/** Guests are sitting there: the switch cannot turn it off, and says why. */
const locked = computed(() => !!props.table?.has_open_tab && props.table.active)

const ZONES = STOLOVI_ZONES.map(z => ({ value: z.value, label: z.label }))

function save() {
  if (!canSave.value) return
  const nextGrp = grp.value.trim() || null
  const nextSort = sort.value ?? 0

  if (!props.table) {
    emit('create', {
      name: name.value.trim(),
      zone: zone.value,
      col: col.value!,
      row: row.value!,
      grp: nextGrp,
      sort: nextSort,
    })
    return
  }

  // Only what moved: the server refuses an empty patch rather than logging a
  // change that changed nothing.
  const t = props.table
  const patch: UpdateTableBody = {}
  if (name.value.trim() !== t.name) patch.name = name.value.trim()
  if (zone.value !== t.zone) patch.zone = zone.value
  if (col.value !== t.col) patch.col = col.value!
  if (row.value !== t.row) patch.row = row.value!
  if (nextGrp !== t.grp) patch.grp = nextGrp
  if (nextSort !== t.sort) patch.sort = nextSort
  if (active.value !== t.active) patch.active = active.value

  if (Object.keys(patch).length === 0) {
    emit('close')
    return
  }
  emit('update', t.id, patch)
}
</script>

<template>
  <UiSheet
    :open="open"
    :title="table ? table.name : 'Novi sto'"
    :pending="pending"
    @close="emit('close')"
  >
    <p v-if="error" class="p-error" role="alert">{{ error }}</p>

    <UiField
      v-model="name"
      label="Naziv"
      placeholder="Sto 16"
      :error="nameError ?? undefined"
      hint="Na planu se vidi bez riječi „Sto“."
    />

    <UiField
      :model-value="zone"
      label="Zona"
      kind="select"
      :options="ZONES"
      @update:model-value="value => zone = value as Zone"
    />

    <div class="p-pair">
      <PostavkeNumField
        :model-value="col"
        kind="int"
        label="Kolona"
        :error="colError"
        hint="Stub stolova, s lijeva"
        @input="value => col = value"
        @commit="value => col = value"
      />
      <PostavkeNumField
        :model-value="row"
        kind="int"
        label="Red"
        :error="rowError"
        hint="Mjesto u stubu, odozgo"
        @input="value => row = value"
        @commit="value => row = value"
      />
    </div>

    <UiField
      v-model="grp"
      label="Grupa"
      placeholder="vip"
      :error="grpError ?? undefined"
      hint="Prazno za običan sto. Stolovi iste grupe crtaju se u svom okviru ispod kolone."
    />

    <PostavkeNumField
      :model-value="sort"
      kind="int"
      label="Redoslijed"
      :error="sortError"
      hint="Redoslijed u spisku za Premjesti. Na planu odlučuju kolona i red."
      @input="value => sort = value"
      @commit="value => sort = value"
    />

    <div v-if="table" class="p-row">
      <span class="p-caption">Aktivan</span>
      <PostavkeToggle
        v-model="active"
        label="Aktivan sto"
        words
        :disabled="locked"
      />
    </div>
    <p v-if="table" class="p-hint">
      <template v-if="locked">Za stolom sjede gosti — ugasiti se može kad se sto isprazni.</template>
      <template v-else>Sto se nikad ne briše. Ugašen sto nestaje s plana, a stare ture ostaju.</template>
    </p>

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Odustani</UiButton>
      <UiButton
        variant="primary"
        :pending="pending"
        :disabled="!canSave"
        @click="save"
      >{{ table ? 'Sačuvaj' : 'Dodaj' }}</UiButton>
    </template>
  </UiSheet>
</template>

<style scoped>
.p-error {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: var(--text-micro);
}

/* Column and row side by side: they are one answer, "where". */
.p-pair { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }

.p-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }

.p-caption {
  font-size: var(--text-caption);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  font-weight: 600;
}

.p-hint { margin: 0; font-size: var(--text-micro); color: var(--muted); }
</style>
