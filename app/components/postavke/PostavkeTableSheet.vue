<script setup lang="ts">
/**
 * *Novi sto* — a table on the floor plan.
 *
 * `col` and `row` are its square on the zone's schematic (1..12 each); `grp` is
 * the one label that groups a few of them, "vip" for the box inside Unutra.
 */
import type { Zone } from '#shared/types'
import type { CreateTableBody } from '#shared/schemas'

const props = defineProps<{
  open: boolean
  /** The zone the owner is looking at — the sensible default for a new table. */
  zone: Zone
  pending: boolean
  error: string | null
}>()

const emit = defineEmits<{ close: [], save: [body: CreateTableBody] }>()

const name = ref('')
const zone = ref<Zone>('unutra')
const col = ref<number | null>(1)
const row = ref<number | null>(1)
const grp = ref('')

watch(() => props.open, (open) => {
  if (!open) return
  name.value = ''
  zone.value = props.zone
  col.value = 1
  row.value = 1
  grp.value = ''
})

const canSave = computed(() =>
  name.value.trim() !== '' && col.value !== null && row.value !== null)

function save() {
  if (!canSave.value) return
  emit('save', {
    name: name.value.trim(),
    zone: zone.value,
    col: col.value as number,
    row: row.value as number,
    grp: grp.value.trim() || null,
  })
}
</script>

<template>
  <UiSheet
    :open="open"
    title="Novi sto"
    :pending="pending"
    @close="emit('close')"
  >
    <p v-if="error" class="p-error" role="alert">{{ error }}</p>

    <UiField v-model="name" label="Naziv" placeholder="Sto 21" />

    <UiField
      :model-value="zone"
      label="Zona"
      kind="select"
      :options="[{ value: 'unutra', label: 'Unutra' }, { value: 'basta', label: 'Bašta' }]"
      @update:model-value="value => zone = value as Zone"
    />

    <div class="p-pair">
      <PostavkeNumField
        label="Kolona"
        :model-value="col"
        kind="int"
        hint="1 do 12"
        @commit="value => col = value"
        @input="value => col = value"
      />
      <PostavkeNumField
        label="Red"
        :model-value="row"
        kind="int"
        hint="1 do 12"
        @commit="value => row = value"
        @input="value => row = value"
      />
    </div>

    <UiField v-model="grp" label="Grupa" hint="Prazno za obični sto; vip za separe." />
      <template #footer>
        <UiButton variant="ghost" @click="emit('close')">Odustani</UiButton>
        <UiButton
          variant="primary"
          :pending="pending"
          :disabled="!canSave"
          @click="save"
        >Dodaj</UiButton>
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

.p-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
</style>
