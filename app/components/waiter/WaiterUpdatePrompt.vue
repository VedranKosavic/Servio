<script setup lang="ts">
/**
 * *Nova verzija — osvježi*, and only between orders.
 *
 * A service worker installs a new build in the background and then waits. This
 * card is the only way it is ever allowed to take over, because taking over
 * means reloading the page — and reloading a page mid-round is how a waiter
 * loses the four taps he has not locked yet.
 *
 * So it is suppressed while there is anything to lose:
 *
 *   - any draft of mine has lines (the round in progress), or
 *   - the outbox is not empty (money still on the phone).
 *
 * And it is mounted only on the two list screens, never on S3, S4 or S5 — a
 * package that adds it to an order screen has misread this comment.
 */
const cart = useCartStore()
const outbox = useOutboxStore()

// One file knows how a waiting build is taken: `useAppUpdate`. The lock screen
// takes it without asking — nothing is unsaved there — and this card is the
// other door, the one that waits for a gap between rounds.
const update = useAppUpdate()

const safeMoment = computed(() => cart.myDrafts.length === 0 && outbox.pending === 0)
const show = computed(() => update.needRefresh.value && safeMoment.value)

const busy = ref(false)
async function refreshNow() {
  busy.value = true
  await update.apply()
}
</script>

<template>
  <div v-if="show" class="card flex items-center gap-3 border-accent-line p-4">
    <div class="grow text-label">
      <span class="font-semibold">Nova verzija</span>
      <span class="text-text-2"> — osvježi da je preuzmeš.</span>
    </div>
    <button type="button" class="btn btn-primary shrink-0" :disabled="busy" @click="refreshNow">
      Osvježi
    </button>
  </div>
</template>
