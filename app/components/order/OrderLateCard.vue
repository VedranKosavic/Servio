<script setup lang="ts">
/**
 * The red card of F3 step 5: a round that reached the server **after** its table
 * had already been paid and closed.
 *
 * It happens for one reason — the phone was in a dead spot. The round is real,
 * the guest drank it, and the server accepts it rather than losing the sale: it
 * opens a new tab born `unpaid` with `pending_review`, and the money sits in
 * this waiter's expected cash until somebody says what happened to it.
 *
 * Only the person who carried the phone knows which it was, and he knows it now
 * rather than at 01:00, so the card asks him plainly. *Naplaćeno gotovina*
 * queues the payment through the outbox like any other. *Nije naplaćeno* leaves
 * the tab where it is — on the owner's *Zahtijeva pažnju* list, with its
 * amount still on this waiter's line, which is exactly what explains the surplus
 * in his envelope.
 *
 * Nothing here blames anybody, and the card never disappears on its own: an
 * unanswered one goes to the bartender's queue after ten minutes (F3), and that
 * is the server's job, not this component's.
 */
import { formatKm } from '#shared/money'

defineProps<{
  tableName: string
  amountFen: number
  busy?: boolean
}>()

defineEmits<{ paid: [], unpaid: [] }>()
</script>

<template>
  <div class="card flex flex-col gap-2 border-danger p-3" role="alert">
    <div class="flex items-center gap-2">
      <span class="chip chip-danger">Kasno sinhronizovano</span>
      <span class="text-sm text-text-2">{{ tableName }}</span>
    </div>
    <p class="text-[15px]">
      Tura je stigla nakon što je sto već bio naplaćen —
      <span class="num font-semibold">{{ formatKm(amountFen) }}</span>.
      Jesi li ovo naplatio?
    </p>
    <div class="flex flex-col gap-2">
      <button type="button" class="btn btn-accent h-12" :disabled="busy" @click="$emit('paid')">
        Naplaćeno gotovina
      </button>
      <button type="button" class="btn h-12" :disabled="busy" @click="$emit('unpaid')">
        Nije naplaćeno
      </button>
    </div>
    <p class="text-sm text-text-2">
      Dok ne odgovoriš, iznos stoji na tvom pazaru.
    </p>
  </div>
</template>
