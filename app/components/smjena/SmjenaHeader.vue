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
 * `Izvoz` is a link, not a fetch: the export page owns the file.
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

/** *Izvoz*, pre-filtered to this night. */
const exportLink = computed(() => ({
  path: '/admin/izvoz',
  query: {
    smjena: props.shift.id,
    from: props.shift.business_date,
    to: props.shift.business_date,
  },
}))
</script>

<template>
  <header class="s-head">
    <div class="s-head-title">
      <h1>Smjena</h1>
      <p class="s-head-line">{{ line }}</p>
    </div>

    <div class="s-head-right">
      <UiPill :tone="pill.tone">{{ statusLabel }}</UiPill>
      <NuxtLink :to="exportLink" class="s-head-export">Izvoz</NuxtLink>
    </div>

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
.s-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px 16px;
  align-items: start;
}

.s-head-title { min-width: 0; }

.s-head-title h1 {
  font-family: var(--font-title);
  font-weight: 700;
  font-size: 28px;
  letter-spacing: -0.015em;
  margin: 0;
  line-height: 1.1;
}

.s-head-line {
  margin: 2px 0 0;
  color: var(--muted);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.s-head-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.s-head-export {
  height: 36px;
  display: inline-flex;
  align-items: center;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink);
  font-weight: 600;
  font-size: 14px;
  text-decoration: none;
}

/* The review row spans both columns: the two fields and the button read as one
   action rather than as inputs that happen to sit near a heading. */
.s-review {
  grid-column: 1 / -1;
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
}

.s-review :deep(.a-field) { width: 220px; max-width: 100%; }

.s-note {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--ink-2);
  font-size: 14px;
}

@media (max-width: 1023px) {
  .s-head { grid-template-columns: minmax(0, 1fr); }
  .s-head-right { justify-content: flex-start; }
  .s-head-export { height: 44px; }
  .s-review :deep(.a-field) { width: 100%; }
  .s-review :deep(.a-btn) { width: 100%; }
}
</style>
