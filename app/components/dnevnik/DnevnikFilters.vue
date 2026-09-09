<script setup lang="ts">
/**
 * *Važno / Sve*, and the three filters — **Osoba · Vrsta · Period**.
 *
 * They compose: each one narrows the same `LogQuery`, and every one of them
 * lives in the route query, so a reload comes back on the same view and a link
 * the owner sends himself opens on it. *Period* is `UiPeriod`, which owns that
 * part of the query on its own (`useAdminPeriod`).
 *
 * *Važno* is not "hide the small stuff": `listLog` keeps any entry that
 * **resolves** a quiet one, so a `void_decided` stays visible and carries its
 * `void_requested` inline. Nothing disappears without a trace.
 */
import type { UserAdmin } from '#shared/types'
import { kindOptions } from './dnevnikKinds'

defineProps<{
  important: boolean
  actor: string
  kind: string
  users: UserAdmin[]
}>()

const emit = defineEmits<{
  'update:important': [value: boolean]
  'update:actor': [value: string]
  'update:kind': [value: string]
}>()

const kinds = kindOptions()

const IMPORTANCE = [
  { value: 'vazno', label: 'Važno' },
  { value: 'sve', label: 'Sve' },
]
</script>

<template>
  <UiCard>
    <div class="d-filters">
      <UiSeg
        :model-value="important ? 'vazno' : 'sve'"
        :options="IMPORTANCE"
        label="Koliko unosa prikazati"
        @update:model-value="emit('update:important', $event === 'vazno')"
      />

      <UiField
        label="Osoba"
        kind="select"
        :model-value="actor"
        :options="[
          { value: '', label: 'Svi' },
          ...users.map(user => ({ value: user.id, label: user.name })),
        ]"
        @update:model-value="emit('update:actor', String($event ?? ''))"
      />

      <UiField
        label="Vrsta"
        kind="select"
        :model-value="kind"
        :options="kinds"
        @update:model-value="emit('update:kind', String($event ?? ''))"
      />

      <div class="d-period">
        <UiPeriod />
      </div>
    </div>
  </UiCard>
</template>

<style scoped>
.d-filters {
  display: grid;
  grid-template-columns: auto 200px 260px minmax(0, 1fr);
  align-items: end;
  gap: 12px;
  min-width: 0;
}

.d-period { min-width: 0; }

@media (max-width: 1023px) {
  /* One column on a phone: every control full width and thumb-sized. */
  .d-filters { grid-template-columns: minmax(0, 1fr); gap: 14px; align-items: stretch; }
}
</style>
