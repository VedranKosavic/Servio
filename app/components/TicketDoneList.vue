<script setup lang="ts">
/**
 * The tail of finished tickets, collapsed by default.
 *
 * It exists for one question only — "did that round for Sto 12 go out?" — so it
 * is closed until asked, and holds the last ten the server still remembers.
 *
 * The heading says *Gotove narudžbe* rather than *Gotovo*: the word *Gotovo* is
 * the action on every open ticket above it, and a screen should not use one word
 * for a button and for a place.
 */
import type { PrepOrder } from '#shared/types'

defineProps<{
  orders: PrepOrder[]
  now: number
}>()

const expanded = ref(false)
</script>

<template>
  <section v-if="orders.length" class="dn">
    <button
      type="button"
      class="dn-toggle"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <span class="eyebrow dn-label">Gotove narudžbe</span>
      <span class="chip num">{{ orders.length }}</span>
      <span class="dn-spacer" />
      <svg
        width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
        class="dn-chev" :class="{ open: expanded }" aria-hidden="true"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>

    <div v-if="expanded" class="card dn-list">
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

<style scoped>
.dn {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* The same shape the lock screen uses for "there is more behind this": a rule,
   a label and a chevron — not a grey slab. */
.dn-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 48px;
  padding: 0 2px;
  border: 0;
  border-top: 1px solid var(--line-soft);
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
  text-align: left;
}

.dn-label { color: var(--ink-2); }

.dn-spacer { flex: 1; }

.dn-chev {
  flex-shrink: 0;
  color: var(--muted);
  transition: transform var(--dur-fast) var(--ease-standard);
}

.dn-chev.open { transform: rotate(180deg); }

.dn-list {
  padding: 2px 16px;
}

.dn-list :deep(.tk-done:last-child) { border-bottom: 0; }
</style>
