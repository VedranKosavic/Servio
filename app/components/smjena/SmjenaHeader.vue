<script setup lang="ts">
/**
 * The top of `/admin/smjena/:id`: which night this is, and what has been done
 * to it.
 *
 * The sentence under the title is the mockup's, in the order it reads there —
 * *pet 11.09.2026. · otvorena 18:03 · zatvorena 00:42 · Emir* — because that is
 * the order the owner asks the questions in: which night, when it started, when
 * it ended, who ended it.
 *
 * **The review block is one route.** `POST /api/shifts/:id/review` takes the
 * card total *and* signs the night off, so there is one form and one button, not
 * two. It appears only on a `closed` shift, because that is the only status the
 * server accepts (an open one answers `409 SHIFT_NOT_CLOSED`), and a card total
 * that differs from the card payments needs a sentence — the server answers
 * `422 NOTE_REQUIRED` and the note field is here for exactly that.
 *
 * **The way back is `UiPageHead`'s own.** It draws *Nazad na Smjene* above the
 * title on every screen that is not a tab destination, so this header builds no
 * back control of its own — two controls doing one job is what the redesign
 * took out of *Roba* as well.
 */
import { shiftStatusPill } from './smjenaLogic'
import type { Shift } from '#shared/types'

const props = defineProps<{
  shift: Shift
  /** `user_id` → name, assembled by the page from the rows it already has. */
  names: Record<string, string>
  /** The card total being typed, in feninga. */
  cardTotal: number | null
  note: string
  pending: boolean
  error?: string
  /** True once the server has asked for a sentence about the card difference. */
  noteRequired?: boolean
}>()

const emit = defineEmits<{
  'update:cardTotal': [value: number | null]
  'update:note': [value: string]
  review: []
}>()

const pill = computed(() => shiftStatusPill(props.shift.status))

/** *pet* — the abbreviated weekdays from the conventions, Sunday first. */
const WEEKDAYS = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub']

const dayLabel = computed(() => {
  const parsed = Date.parse(`${props.shift.business_date}T12:00:00Z`)
  if (Number.isNaN(parsed)) return dateBs(props.shift.business_date)
  return `${WEEKDAYS[new Date(parsed).getUTCDay()]} ${dateBs(props.shift.business_date)}`
})

/** A name if this page has seen the person on one of its own rows, else nothing. */
function nameOf(userId: string | null): string {
  return userId ? props.names[userId] ?? '' : ''
}

const line = computed(() => {
  const parts = [dayLabel.value, `otvorena ${timeBs(props.shift.opened_at)}`]
  if (props.shift.closed_at) {
    parts.push(`zatvorena ${timeBs(props.shift.closed_at)}`)
    const closer = nameOf(props.shift.closed_by)
    if (closer) parts.push(closer)
    if (props.shift.closed_kind === 'forced') parts.push('prisilno zatvorena')
  }
  parts.push(spanBs(props.shift.opened_at, props.shift.closed_at))
  return parts.filter(Boolean).join(' · ')
})

/** "pregledano · Haris 09:14", when the night has been signed off. */
const statusLabel = computed(() => {
  if (props.shift.status !== 'reviewed') return pill.value.word
  const who = nameOf(props.shift.reviewed_by)
  return `pregledano${who ? ` · ${who}` : ''} ${timeBs(props.shift.reviewed_at)}`.trim()
})

const cardModel = computed({
  get: () => props.cardTotal,
  set: (value: string | number | null) =>
    emit('update:cardTotal', typeof value === 'number' ? value : null),
})

const noteModel = computed({
  get: () => props.note,
  set: (value: string | number | null) => emit('update:note', String(value ?? '')),
})
</script>

<template>
  <header class="s-head">
    <UiPageHead eyebrow="Lokal" title="Smjena" :sub="line">
      <!-- The status is the whole of this head's right-hand side. *Izvoz* used
           to sit beside it and pointed at `/admin/izvoz`, a page the dashboard
           no longer has. -->
      <template #actions>
        <UiPill :tone="pill.tone">{{ statusLabel }}</UiPill>
      </template>
    </UiPageHead>

    <div v-if="shift.status === 'closed'" class="s-review">
      <UiField
        v-model="cardModel"
        label="Ukupno s terminala"
        kind="money"
        hint="Unosi se u KM"
        :error="error"
      />
      <UiField
        v-model="noteModel"
        label="Napomena"
        :placeholder="noteRequired ? 'Objasni razliku kartice' : 'Nije obavezno'"
        :error="noteRequired && !note.trim() ? 'Razlika kartice traži napomenu' : undefined"
      />
      <UiButton variant="primary" :pending="pending" @click="emit('review')">
        Pregledano
      </UiButton>
    </div>

    <p v-else-if="shift.closing_note" class="s-note">
      Napomena: {{ shift.closing_note }}
    </p>
  </header>
</template>

<style scoped>
.s-head { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

/* The review row is one action, so it sits in a well of its own rather than as
   three controls loose under a heading. */
.s-review {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
  padding: 14px 16px;
  border-radius: var(--radius-card);
  background: var(--surface-2);
}

.s-review :deep(.a-field) { width: 220px; max-width: 100%; }

.s-note {
  margin: 0;
  padding: 10px 14px;
  border-radius: var(--radius-field);
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: var(--text-label);
}

@media (max-width: 1023px) {
  .s-review :deep(.a-field) { width: 100%; }
  .s-review :deep(.a-btn) { width: 100%; }
}
</style>
