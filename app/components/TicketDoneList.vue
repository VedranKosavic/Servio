<script setup lang="ts">
/**
 * "Gotovo (10)" — the tail of finished tickets, collapsed by default.
 *
 * It exists for one question only: "did that round for Sto 12 go out?" So it
 * is closed until asked, and holds the last ten the server still remembers.
 */
import type { PrepOrder } from '#shared/types'

defineProps<{
  orders: PrepOrder[]
  now: number
}>()

const expanded = ref(false)
</script>

<template>
  <section v-if="orders.length" class="pt-1">
    <button
      type="button"
      class="flex w-full items-center gap-2 py-3 text-left text-text-2"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <span class="font-semibold">Gotovo ({{ orders.length }})</span>
      <svg
        width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
        class="transition-transform" :class="expanded ? 'rotate-180' : ''"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>

    <div v-if="expanded" class="flex flex-col gap-3 pb-2">
      <TicketCard
        v-for="order in orders"
        :key="order.order_id"
        :order="order"
        :now="now"
        done
      />
    </div>
  </section>
</template>
