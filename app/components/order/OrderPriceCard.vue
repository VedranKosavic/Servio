<script setup lang="ts">
/**
 * *"Cijena promijenjena"* — the amber card after a lock whose total came back
 * different from the one on the button (F3 step 3).
 *
 * The phone never sends a price; it shows one, so the waiter can read a number
 * out to a guest, and it takes that number from the catalogue it downloaded at
 * boot. When the owner changes a price in `/admin` mid-evening, that catalogue is a
 * few minutes stale and the guest was quoted the old number.
 *
 * The card exists so nobody discovers this at the till. It names the difference,
 * and the screen behind it refetches `/api/bootstrap` so the next round is
 * quoted right. **The server's number stands** — it was read inside the lock
 * transaction — and there is nothing to approve here: one *U redu*, and it is
 * gone.
 */
import { formatKm } from '#shared/money'

const props = defineProps<{
  tableName: string
  /** What the tiles added up to on this phone. */
  draftFen: number
  /** What the server charged, read from the catalogue inside the transaction. */
  serverFen: number
}>()

defineEmits<{ close: [] }>()

const diff = computed(() => props.serverFen - props.draftFen)
</script>

<template>
  <div class="card flex flex-col gap-2 border-warn p-3" role="status">
    <div class="flex items-center gap-2">
      <span class="chip chip-warn">Cijena promijenjena</span>
      <span class="text-sm text-text-2">{{ tableName }}</span>
    </div>
    <p class="text-[15px]">
      Na ekranu je pisalo <span class="num">{{ formatKm(draftFen) }}</span>, naplaćeno je
      <span class="num font-semibold">{{ formatKm(serverFen) }}</span>
      <template v-if="diff !== 0">
        ({{ diff > 0 ? '+' : '−' }}<span class="num">{{ formatKm(Math.abs(diff)) }}</span>)
      </template>.
      Cijena je promijenjena u međuvremenu; meni je osvježen.
    </p>
    <button type="button" class="btn h-12" @click="$emit('close')">
      U redu
    </button>
  </div>
</template>
