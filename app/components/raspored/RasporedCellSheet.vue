<script setup lang="ts">
/**
 * What the owner can do to one person in one cell — `/a`, light kit.
 *
 * **The past and the future are different sheets behind one title**, and that is
 * the point of the file. Before the day, a cell is a plan: a name can come off
 * it. After the day, a cell is a record of who was supposed to be there, and the
 * server refuses to un-staff it (`422 PAST_LOCKED`) — an owner cannot
 * retroactively take somebody off the night the stock went missing. So the past
 * offers *Nije došao* and *Bolestan* and nothing that erases, and the sheet says
 * why rather than showing a button that will be refused.
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
  status: [status: 'planned' | 'absent' | 'sick']
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

      <p v-if="person.status !== 'planned'" class="r-now">
        Sada: <strong>{{ STATUS_BS[person.status] }}</strong>
      </p>

      <p v-if="person.swap_pending" class="r-note">
        Za ovu smjenu je tražena zamjena. Izmjena ćelije povlači taj zahtjev.
      </p>

      <p v-if="person.note" class="r-note">{{ person.note }}</p>

      <p v-if="person.updated_by_name && person.updated_at" class="r-quiet">
        izmijenjeno {{ dateBs(person.updated_at) }} · {{ person.updated_by_name }}
      </p>

      <div class="r-acts">
        <template v-if="past">
          <UiButton
            v-if="person.status !== 'absent'"
            variant="ghost" :pending="pending" @click="emit('status', 'absent')"
          >Nije došao</UiButton>
          <UiButton
            v-if="person.status !== 'sick'"
            variant="ghost" :pending="pending" @click="emit('status', 'sick')"
          >Bolestan</UiButton>
          <UiButton
            v-if="person.status !== 'planned'"
            variant="ghost" :pending="pending" @click="emit('status', 'planned')"
          >Vrati u planirano</UiButton>
        </template>

        <template v-else>
          <UiButton
            v-if="person.status !== 'sick'"
            variant="ghost" :pending="pending" @click="emit('status', 'sick')"
          >Bolestan</UiButton>
          <UiButton
            v-if="person.status !== 'planned'"
            variant="ghost" :pending="pending" @click="emit('status', 'planned')"
          >Vrati u planirano</UiButton>
          <UiButton variant="danger" :pending="pending" @click="emit('remove')">
            Ukloni sa smjene
          </UiButton>
        </template>
      </div>

      <p v-if="past" class="r-quiet">
        Prošli dan se ne uklanja — ostaje zapisano ko je bio na rasporedu.
      </p>

      <p v-if="error" class="r-error" role="alert">{{ error }}</p>
    </div>
  </UiSheet>
</template>

<style scoped>
.r-cell { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.r-span { margin: 0; font-weight: 600; }
.r-now { margin: 0; color: var(--ink-2); }
.r-note { margin: 0; color: var(--ink-2); font-size: 14px; }
.r-quiet { margin: 0; color: var(--muted); font-size: 13px; }
.r-error { margin: 0; color: var(--danger); font-weight: 500; }

.r-acts { display: flex; flex-wrap: wrap; gap: 8px; }

@media (max-width: 1023px) {
  .r-acts { flex-direction: column; }
  .r-acts :deep(.a-btn) { width: 100%; height: 48px; }
}
</style>
