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
 * ***Nije plaćeno* is gone entirely** (the owner, 23.09.2026). A guest who
 * walks out is the waiter's own affair: he taps *Naplati* and the round is in
 * the night's total like any other, with the money coming out of his pocket
 * rather than the guest's. That is the café's rule, and it means the tab can
 * never sit owing with nobody answerable for it.
 *
 * The four marks that *are* still there — policija, rashod, osoblje, otpis —
 * are a different thing and live elsewhere (the table sheet and the Šank
 * sheet): goods that left the shelf without money **by arrangement**, counted
 * as sold and taken off the shift rather than off the waiter.
 */
import { formatKm } from '#shared/money'
import type { PaymentMethod } from '#shared/types'

const props = withDefaults(defineProps<{
  tableName: string
  /** What is still owed — the number this sheet is about. */
  remainingFen: number
  /** What the guests were charged in total, for the line above it. */
  totalFen: number
  busy?: boolean
  error?: string | null
}>(), { busy: false, error: null })

const emit = defineEmits<{
  close: []
  pay: [payment: { method: PaymentMethod, amount_fen: number, received_fen?: number }]
}>()

useSheetDismiss(() => emit('close'))

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
      </div>
    </div>
  </div>
</template>

