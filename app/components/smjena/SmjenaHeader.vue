<script setup lang="ts">
/**
 * The top of `/admin/smjena/:id`: which night this is, and its status.
 *
 * The sentence under the title reads in the order the owner asks the questions
 * — *pet 11.09.2026. · otvorena 18:03 · zatvorena 00:42 · Emir* — which night,
 * when it started, when it ended, who ended it.
 *
 * **There is no review form any more.** *Ukupno s terminala* and *Pregledano*
 * went on the owner's call: the café takes no cards, and the šanker's
 * *Zaključi smjenu* is the sign-off. `POST /api/shifts/:id/review` still exists
 * for the API; nothing on this screen calls it.
 *
 * **The way back is `UiPageHead`'s own**, drawn above the title, so this header
 * builds no back control of its own.
 */
import { shiftStatusPill } from './smjenaLogic'
import type { Shift } from '#shared/types'

const props = defineProps<{
  shift: Shift
  /** `user_id` → name, assembled by the page from the rows it already has. */
  names: Record<string, string>
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

/** "pregledano · Haris 09:14", for a night signed off before the form went. */
const statusLabel = computed(() => {
  if (props.shift.status !== 'reviewed') return pill.value.word
  const who = nameOf(props.shift.reviewed_by)
  return `pregledano${who ? ` · ${who}` : ''} ${timeBs(props.shift.reviewed_at)}`.trim()
})
</script>

<template>
  <header class="s-head">
    <UiPageHead eyebrow="Lokal" title="Smjena" :sub="line">
      <template #actions>
        <UiPill :tone="pill.tone">{{ statusLabel }}</UiPill>
      </template>
    </UiPageHead>

    <p v-if="shift.closing_note" class="s-note">
      Napomena: {{ shift.closing_note }}
    </p>
  </header>
</template>

<style scoped>
.s-head { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

.s-note {
  margin: 0;
  padding: 10px 14px;
  border-radius: var(--radius-field);
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: var(--text-label);
}
</style>
