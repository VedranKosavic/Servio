<script setup lang="ts">
/**
 * One waiting request in the bartender's *Na čekanju* queue (S14).
 *
 * Everything a person needs to answer it is on the card, because a bartender
 * with a tray in one hand is not going to open anything: **who** asked, **which
 * table**, **which line**, **how much**, **why**, and what it does to the shelf.
 *
 * The two buttons are only drawn while `can_decide` is true — the server's own
 * answer to "would this person, in this role, in this window, get past
 * `requireDecider` right now". Past `bartender_approve_window_s` the card says
 * *Ide vlasniku* instead, which is the truth rather than a button that 403s.
 *
 * `can_decide` is computed when the list is read, and a bartender's window keeps
 * closing while he is standing there. So the card keeps counting: the line's age
 * is `seconds_since_lock` plus however long the request has been waiting, and the
 * buttons go away by themselves the second it crosses the window. Without that,
 * the queue would offer a button that had quietly become a 403 — and the server
 * would be the one to say so, after the tap.
 *
 * *Odobri* is `btn-primary` and *Odbij* is a ghost, deliberately: approving is the
 * common, low-harm answer, and a rejection leaves a waiter's money on his own
 * envelope, so it should take the more deliberate tap.
 */
import { formatKm } from '#shared/money'
import { reasonLabel } from '~/composables/useAdjustments'
import type { PendingAdjustment } from '#shared/types'

const props = withDefaults(defineProps<{
  row: PendingAdjustment
  /** One clock for the whole screen, so "čeka 4 min" keeps counting. */
  now: number
  /**
   * `bartender_approve_window_s`, or `null` for an owner — his authority has no
   * window, so nothing here should take his buttons away.
   */
  windowS?: number | null
  busy?: boolean
}>(), { windowS: null, busy: false })

const emit = defineEmits<{
  decide: [id: string, outcome: 'applied' | 'rejected']
}>()

const isVoid = computed(() => props.row.kind === 'void')
const waiting = computed(() => ticketAge(props.row.created_at, props.now))

/** How old the *line* is now: its age when the storno was asked for, plus the wait. */
const lineAgeS = computed(() =>
  props.row.seconds_since_lock + ticketAgeSeconds(props.row.created_at, props.now))

const expired = computed(() => props.windowS !== null && lineAgeS.value > props.windowS)
const decidable = computed(() => props.row.can_decide && !expired.value)
</script>

<template>
  <article class="card flex flex-col gap-2.5 p-3.5">
    <div class="flex items-baseline gap-2">
      <h2 class="min-w-0 flex-1 truncate text-lg font-bold">
        {{ isVoid ? 'Storno' : 'Na račun kuće' }} · {{ row.requested_by_name }}
      </h2>
      <span class="num shrink-0 text-2xl font-bold">{{ formatKm(row.amount_fen) }}</span>
    </div>

    <p class="text-body">
      <span class="text-text-2">{{ row.table_name }} ·</span>
      {{ row.qty }}× {{ row.line_name }}
    </p>

    <div class="flex flex-wrap items-center gap-2">
      <span class="chip">{{ reasonLabel(row.reason) }}</span>
      <span v-if="isVoid" :class="['chip', row.restock ? 'chip-good' : '']">
        {{ row.restock ? 'vraća na stanje' : 'ne vraća na stanje' }}
      </span>
      <span v-if="row.was_paid" class="chip chip-danger">nakon naplate</span>
      <span class="num text-label text-text-2">{{ waiting }}</span>
    </div>

    <p v-if="row.note" class="note">
      „{{ row.note }}“
    </p>

    <div v-if="decidable" class="flex gap-2">
      <button
        type="button"
        class="btn btn-primary h-14 flex-1 text-lg"
        :disabled="busy"
        @click="emit('decide', row.id, 'applied')"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7" />
        </svg>
        Odobri
      </button>
      <button
        type="button"
        class="btn btn-ghost h-14 flex-1 text-lg"
        :disabled="busy"
        @click="emit('decide', row.id, 'rejected')"
      >
        Odbij
      </button>
    </div>

    <p v-else class="note note-warn">
      Ide vlasniku — isteklo je vrijeme za šankera.
    </p>
  </article>
</template>
