<script setup lang="ts">
/**
 * *Popravi ili odbaci* — a queued body the server read and refused.
 *
 * This is the one outcome retrying cannot fix. A 4xx means the server
 * understood the request and said no: the table was already paid, the product
 * is gone, the body is from a build that no longer exists. So the entry stops,
 * and everything behind it **on the same tab** stops with it — a payment must
 * not go out for a round that was refused. Other tables keep flushing.
 *
 * The card names three things, because a waiter cannot decide without all
 * three: which table, how much, and what the server actually said.
 */
import { formatKm } from '#shared/money'
import type { OutboxEntry } from '~/stores/outbox'

const outbox = useOutboxStore()

const KIND_LABEL: Record<OutboxEntry['kind'], string> = {
  order: 'Tura',
  pay: 'Naplata',
  unpaid: 'Nije plaćeno',
  adjust: 'Storno',
  waste: 'Otpis',
}

const busy = ref<string | null>(null)

async function retry(entry: OutboxEntry) {
  busy.value = entry.client_id
  try {
    await outbox.retry(entry.client_id)
  } finally {
    busy.value = null
  }
}

async function discard(entry: OutboxEntry) {
  busy.value = entry.client_id
  try {
    await outbox.discard(entry.client_id)
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div
    v-for="entry in outbox.failed"
    :key="entry.client_id"
    class="card flex flex-col gap-2.5 border-danger p-3"
  >
    <div class="flex items-baseline gap-2">
      <span class="font-semibold text-danger">{{ KIND_LABEL[entry.kind] }}</span>
      <span v-if="entry.label" class="text-text-2">{{ entry.label }}</span>
      <span v-if="entry.amount_fen !== undefined" class="num ml-auto font-semibold">
        {{ formatKm(entry.amount_fen) }}
      </span>
    </div>

    <p class="text-label text-text-2">
      {{ entry.last_error ?? 'Server nije prihvatio ovo.' }}
    </p>

    <div class="flex gap-2">
      <button
        type="button"
        class="btn btn-primary flex-1"
        :disabled="busy === entry.client_id"
        @click="retry(entry)"
      >
        Popravi
      </button>
      <button
        type="button"
        class="btn btn-ghost flex-1"
        :disabled="busy === entry.client_id"
        @click="discard(entry)"
      >
        Odbaci
      </button>
    </div>
  </div>
</template>
