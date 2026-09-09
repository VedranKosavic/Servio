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

// `$pwa` is what `@vite-pwa/nuxt` injects with `registerType: 'prompt'`. It is
// absent under `npm run dev` (the worker is off there), hence the optional read.
const { $pwa } = useNuxtApp() as unknown as {
  $pwa?: { needRefresh: boolean, updateServiceWorker: (reload?: boolean) => Promise<void> }
}

const safeMoment = computed(() => cart.myDrafts.length === 0 && outbox.pending === 0)
const show = computed(() => $pwa?.needRefresh === true && safeMoment.value)

const busy = ref(false)
async function refreshNow() {
  busy.value = true
  await $pwa?.updateServiceWorker(true)
}
</script>

<template>
  <div v-if="show" class="card flex items-center gap-3 border-accent p-3">
    <div class="grow text-[15px]">
      <span class="font-semibold">Nova verzija</span>
      <span class="text-text-2"> — osvježi da je preuzmeš.</span>
    </div>
    <button type="button" class="btn btn-accent shrink-0" :disabled="busy" @click="refreshNow">
      Osvježi
    </button>
  </div>
</template>
