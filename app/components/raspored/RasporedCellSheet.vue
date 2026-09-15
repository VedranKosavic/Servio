<script setup lang="ts">
/**
 * One person in one cell of the weekly pattern — `/admin`, light kit.
 *
 * **One action.** A cell is a plan with no dates, so the only thing to do with a
 * name on it is take it off, and that is saved for every week at once. The sheet
 * is the small confirm in front of it: a stray tap on a chip removes nobody.
 */
import { weekdayLongBs } from '#shared/dates'
import { timeSpanBs } from '~/composables/useRoster'
import type { PatternEntry, ShiftTemplateView } from '#shared/types'

const props = defineProps<{
  open: boolean
  person: PatternEntry | null
  template?: ShiftTemplateView
  pending?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  close: []
  remove: []
}>()

const title = computed(() => props.person
  ? `${props.person.user_name} · ${weekdayLongBs(props.person.weekday)}`
  : 'Smjena')

const span = computed(() => props.template
  ? `${props.template.name} ${timeSpanBs(props.template.start_time, props.template.end_time)}`
  : '')
</script>

<template>
  <UiSheet :open="open" :title="title" @close="emit('close')">
    <div v-if="person" class="r-cell">
      <p v-if="span" class="r-span">{{ span }}</p>

      <p class="r-note">Uklanjanje važi za svaku sedmicu.</p>

      <div class="r-acts">
        <UiButton variant="danger" :pending="pending" @click="emit('remove')">
          Ukloni sa smjene
        </UiButton>
      </div>

      <p v-if="error" class="r-error" role="alert">{{ error }}</p>
    </div>
  </UiSheet>
</template>

<style scoped>
.r-cell { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.r-span { margin: 0; font-weight: 600; }
.r-note { margin: 0; color: var(--ink-2); font-size: var(--text-label); }
.r-error { margin: 0; color: var(--danger); font-weight: 500; }

.r-acts { display: flex; flex-wrap: wrap; gap: 8px; }

@media (max-width: 1023px) {
  .r-acts { flex-direction: column; }
  .r-acts :deep(.a-btn) { width: 100%; height: 48px; }
}
</style>
