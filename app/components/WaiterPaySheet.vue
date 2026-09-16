<script setup lang="ts">
/**
 * *Naplati* (S8) — the sheet that closes a table.
 *
 * **Two buttons, on the owner's word (16.09.2026): *Naplati* and *Otkaži*.**
 * It used to offer the notes people pay with (20, 50, 100) with the change
 * worked out under each, *Drugi iznos* for a partial payment, *Kartica* where
 * the venue takes cards, and *Nije plaćeno*. All of that is gone from the main
 * screen: the guests pay what they owe, in cash, and the waiter taps once.
 *
 * `amount_fen` is what the café keeps and there is no `received_fen` any more —
 * with the exact amount the only amount, the change is always nothing, and the
 * server was never told a price here anyway (it priced the round at lock).
 *
 * *Nije plaćeno* is still **reachable, but not from here**: the table's own ⋯
 * menu opens this sheet with `initial-mode="unpaid"`, which is the screen a
 * waiter needs when guests walk out. Losing it entirely would mean a night that
 * cannot say where the money went.
 */
import { formatKm } from '#shared/money'
import type { PaymentMethod } from '#shared/types'

const props = withDefaults(defineProps<{
  tableName: string
  /** What is still owed — the number this sheet is about. */
  remainingFen: number
  /** What the guests were charged in total, for the line above it. */
  totalFen: number
  /**
   * Which half the sheet opens on. ⋯ → *Nije plaćeno* comes straight here, so
   * a guest who walked out costs the same two taps as one who paid.
   */
  initialMode?: 'main' | 'unpaid'
  busy?: boolean
  error?: string | null
}>(), { initialMode: 'main', busy: false, error: null })

const emit = defineEmits<{
  close: []
  pay: [payment: { method: PaymentMethod, amount_fen: number, received_fen?: number }]
  unpaid: [reason: 'walked_out' | 'dispute' | 'other']
}>()

useSheetDismiss(() => emit('close'))

type Mode = 'main' | 'unpaid'
const mode = ref<Mode>(props.initialMode)

/**
 * **One tap is one payment.** `busy` alone is not enough: queueing is fast
 * enough that a double tap can land either side of it, and the second one is a
 * second payment for a tab that is already settled — a 409 and a red card in
 * the outbox at the exact moment a guest is walking away. The latch is per
 * opening of the sheet, so re-opening a tab that is still owed works normally.
 */
const sent = ref(false)

function payExact() {
  if (props.busy || sent.value) return
  sent.value = true
  emit('pay', { method: 'cash', amount_fen: props.remainingFen })
}

const UNPAID_REASONS = [
  { id: 'walked_out', label: 'Otišli bez plaćanja' },
  { id: 'dispute', label: 'Spor oko računa' },
  { id: 'other', label: 'Drugo' },
] as const
</script>

<template>
  <div class="fixed inset-0 z-50">
    <div class="sheet-scrim" @click="emit('close')" />

    <div class="absolute inset-x-0 bottom-0 mx-auto w-full max-w-3xl">
      <div
        class="sheet-panel flex max-h-[92dvh] flex-col gap-3 overflow-y-auto px-4 pb-5 pt-3"
        role="dialog"
        aria-label="Naplata"
      >
        <span class="mx-auto h-1 w-10 shrink-0 rounded-chip bg-line" aria-hidden="true" />

        <!-- What the sheet is about, at the size the sheet is about it. -->
        <header class="flex flex-col gap-1 pb-1">
          <p class="eyebrow truncate">
            {{ tableName }}
          </p>
          <p class="metric num">
            {{ formatKm(remainingFen) }}
          </p>
          <p v-if="remainingFen !== totalFen" class="num text-label text-text-2">
            Od ukupno {{ formatKm(totalFen) }} — ostatak duga.
          </p>
        </header>

        <p v-if="error" class="note note-danger" role="alert">
          {{ error }}
        </p>

        <!-- One tap takes the money, one closes the sheet. -->
        <template v-if="mode === 'main'">
          <button
            type="button"
            class="btn btn-primary btn-lg"
            :disabled="busy || sent"
            @click="payExact"
          >
            {{ busy || sent ? 'Naplaćujem…' : 'Naplati' }}
          </button>
          <button type="button" class="btn btn-ghost" :disabled="busy" @click="emit('close')">
            Otkaži
          </button>
        </template>

        <!-- Nije plaćeno: why. Opened from the table's ⋯ menu, never from
             the buttons above. -->
        <template v-else>
          <p class="note">
            Sto ostaje na tebi dok vlasnik ne odluči. Reci šta se desilo.
          </p>
          <button
            v-for="reason in UNPAID_REASONS"
            :key="reason.id"
            type="button"
            class="btn btn-secondary btn-lg justify-start"
            :disabled="busy"
            @click="emit('unpaid', reason.id)"
          >
            {{ reason.label }}
          </button>
          <button type="button" class="btn btn-ghost" :disabled="busy" @click="mode = 'main'">
            Nazad
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

