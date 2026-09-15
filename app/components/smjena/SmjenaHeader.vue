<script setup lang="ts">
/**
 * The top of `/admin/smjena/:id`: which shift this is, who worked it, and its
 * status.
 *
 * The title is the slot — *Prva smjena*, *Druga smjena* — from `shiftSlotName`,
 * and under it the crew: *Konobar: Amar, Dino · Šanker: Emir* (`shiftCrew`).
 * The sentence below reads in the order the owner asks the questions — which
 * night, when it started, when it ended, how long.
 *
 * **There is no review form any more.** *Ukupno s terminala* and *Pregledano*
 * went on the owner's call: the café takes no cards, and the šanker's
 * *Zaključi smjenu* is the sign-off.
 *
 * **The way back is `UiPageHead`'s own**, drawn above the title, so this header
 * builds no back control of its own.
 */
import { shiftStatusPill } from './smjenaLogic'
import type { Shift } from '#shared/types'

const props = withDefaults(defineProps<{
  shift: Shift
  /** `user_id` → name, assembled by the page from the rows it already has. */
  names: Record<string, string>
  /** *Prva smjena* / *Druga smjena* / *Vanredna smjena*. */
  title?: string
  /** Who locked rounds, and who closed it as šanker. */
  crew?: { konobari: string[], sanker: string | null }
}>(), { title: 'Smjena', crew: () => ({ konobari: [], sanker: null }) })

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
    if (props.shift.closed_kind === 'forced') parts.push('prisilno zatvorena')
  }
  parts.push(spanBs(props.shift.opened_at, props.shift.closed_at))
  return parts.filter(Boolean).join(' · ')
})

/** *Konobar: Amar, Dino · Šanker: Emir* — a dash where nobody is known yet. */
const crewLine = computed(() => {
  const konobari = props.crew.konobari.length ? props.crew.konobari.join(', ') : '—'
  const label = props.crew.konobari.length > 1 ? 'Konobari' : 'Konobar'
  return `${label}: ${konobari} · Šanker: ${props.crew.sanker ?? '—'}`
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
    <UiPageHead eyebrow="Lokal" :title="title" :sub="line">
      <template #actions>
        <UiPill :tone="pill.tone">{{ statusLabel }}</UiPill>
      </template>
    </UiPageHead>

    <p class="s-crew">{{ crewLine }}</p>

    <p v-if="shift.closing_note" class="s-note">
      Napomena: {{ shift.closing_note }}
    </p>
  </header>
</template>

<style scoped>
.s-head { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

.s-crew {
  margin: 0;
  color: var(--ink-2);
  font-size: var(--text-body);
  font-weight: 600;
}

.s-note {
  margin: 0;
  padding: 10px 14px;
  border-radius: var(--radius-field);
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: var(--text-label);
}
</style>
