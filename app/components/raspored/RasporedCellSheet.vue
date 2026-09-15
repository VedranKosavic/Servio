<script setup lang="ts">
/**
 * What the owner can do to one person in one cell — `/admin`, light kit.
 *
 * **One action, and only before the day.** The roster has no swaps and no sick
 * or absent marks ("Ne trebaju nam zamjene i bolovanje"), so a cell is a plan,
 * and the one thing to do with a name on it is take it off. After the day the
 * server refuses that (`409 ROSTER_LOCKED`) — an owner cannot retroactively take
 * somebody off the night the stock went missing — so the past sheet only says
 * who was on the plan and why nothing can change, rather than showing a button
 * that will be refused.
 *
 * An **inherited** cell (the published raspored repeating) says so: taking a name
 * off there writes this week down as a draft of its own first.
 */
import type { Assignment } from '#shared/types'

const props = defineProps<{
  open: boolean
  person: Assignment | null
  /** `work_date < today` — the business date, resolved by the page. */
  past: boolean
  pending?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  close: []
  remove: []
}>()

const title = computed(() => props.person
  ? `${props.person.user_name} · ${dayLabelBs(props.person.work_date)}`
  : 'Smjena')

const span = computed(() => props.person
  ? `${props.person.template_name} ${timeSpanBs(props.person.start_time, props.person.end_time)}`
  : '')
</script>

<template>
  <UiSheet :open="open" :title="title" @close="emit('close')">
    <div v-if="person" class="r-cell">
      <p class="r-span">{{ span }}</p>

      <p v-if="person.status === 'removed'" class="r-now">
        Sada: <strong>{{ STATUS_BS.removed }}</strong>
      </p>

      <p v-if="person.inherited" class="r-note">
        Ova smjena dolazi iz objavljenog rasporeda koji se ponavlja svake sedmice.
        Ako je ukloniš, ova sedmica postaje nacrt.
      </p>

      <p v-if="person.note" class="r-note">{{ person.note }}</p>

      <p v-if="person.updated_by_name && person.updated_at" class="r-quiet">
        izmijenjeno {{ dateBs(person.updated_at) }} · {{ person.updated_by_name }}
      </p>

      <div v-if="!past && person.status !== 'removed'" class="r-acts">
        <UiButton variant="danger" :pending="pending" @click="emit('remove')">
          Ukloni sa smjene
        </UiButton>
      </div>

      <p v-if="past" class="r-quiet">
        Prošli dan se ne mijenja — ostaje zapisano ko je bio na rasporedu.
      </p>

      <p v-if="error" class="r-error" role="alert">{{ error }}</p>
    </div>
  </UiSheet>
</template>

<style scoped>
.r-cell { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.r-span { margin: 0; font-weight: 600; }
.r-now { margin: 0; color: var(--ink-2); }
.r-note { margin: 0; color: var(--ink-2); font-size: var(--text-label); }
.r-quiet { margin: 0; color: var(--muted); font-size: var(--text-micro); }
.r-error { margin: 0; color: var(--danger); font-weight: 500; }

.r-acts { display: flex; flex-wrap: wrap; gap: 8px; }

@media (max-width: 1023px) {
  .r-acts { flex-direction: column; }
  .r-acts :deep(.a-btn) { width: 100%; height: 48px; }
}
</style>
