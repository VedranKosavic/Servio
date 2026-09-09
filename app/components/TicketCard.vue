<script setup lang="ts">
/**
 * One ticket: a table, a waiter, a time, the lines, and *Gotovo*.
 *
 * No prices anywhere — the bartender does not see money in this app (PLAN.md
 * §2). `now` is passed in rather than read here so every card on the screen
 * ages against the same clock tick instead of running its own timer.
 */
import type { PrepOrder } from '#shared/types'

const props = defineProps<{
  order: PrepOrder
  /** `Date.now()`, ticking in the page every couple of seconds. */
  now: number
  /** A finished ticket: greyed, no button, shows when it was done. */
  done?: boolean
  /** The queue's first ticket gets the accent button — it is the one to make next. */
  primary?: boolean
  busy?: boolean
}>()

const emit = defineEmits<{ done: [order: PrepOrder] }>()

/** Under half a minute old: still "NOVO", worth an accent header. */
const isNew = computed(() => !props.done && ticketAgeSeconds(props.order.created_at, props.now) <= 30)
const age = computed(() => ticketAge(props.order.created_at, props.now))
</script>

<template>
  <article class="card overflow-hidden" :class="done ? 'opacity-55' : ''">
    <header
      class="flex items-center gap-2 px-3.5 py-3"
      :class="isNew ? 'bg-accent text-accent-ink' : 'bg-surface-2'"
    >
      <span class="text-lg font-bold">{{ order.table_name }}</span>
      <span class="truncate text-sm opacity-85">
        {{ order.waiter_name }} · {{ clockHm(order.created_at) }}
      </span>
      <span class="ml-auto shrink-0 text-[13px] font-bold">
        <template v-if="done">gotovo {{ clockHm(order.prepared_at) }}</template>
        <template v-else-if="isNew">NOVO · {{ age }}</template>
        <template v-else>{{ age }}</template>
      </span>
    </header>

    <div class="flex flex-col gap-2.5 px-3.5 pb-3.5 pt-2.5">
      <p v-if="order.note" class="rounded-lg bg-warn-soft px-3 py-2 text-[15px] text-warn">
        {{ order.note }}
      </p>

      <div v-for="(line, index) in order.lines" :key="index" class="flex gap-2.5 text-[17px]">
        <b class="num w-9 shrink-0">{{ line.qty }}×</b>
        <div class="min-w-0">
          <span>{{ line.name_snapshot }}</span>
          <span v-if="line.flavours.length" class="text-text-2"> · {{ line.flavours.join(' + ') }}</span>
          <div v-if="line.note" class="text-sm text-muted">
            {{ line.note }}
          </div>
        </div>
      </div>

      <button
        v-if="!done"
        type="button"
        class="btn h-13 w-full"
        :class="primary ? 'btn-accent' : 'btn-ghost'"
        :disabled="busy"
        @click="emit('done', order)"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12l5 5L20 7" />
        </svg>
        Gotovo
      </button>
    </div>
  </article>
</template>
