<script setup lang="ts">
/**
 * *Dopuni smjenu* — the other half of opening a shift (F1 step 3).
 *
 * The shift itself opens on its own, with the first locked round; what needs a
 * person is the change. The šanker counts the drawer, hands each waiter his
 * float, and taps it in here: `float_out` moves that money out of the drawer
 * and onto that waiter's expected cash, which is what makes his settlement add
 * up at the end of the night.
 *
 * Money in, money out, and never both by accident: this card only ever posts
 * `float_out`. A waiter handing change *back* is the settlement's job.
 */
import { formatKm, parseKm } from '#shared/money'
import type { User } from '#shared/types'

const props = defineProps<{
  waiters: User[]
  busy?: boolean
  error?: string | null
  /** Who has already been given change tonight, from this screen. */
  given: Record<string, number>
}>()

const emit = defineEmits<{ float: [{ userId: string, amountFen: number }] }>()

const amounts = ref<Record<string, string>>({})

function amountOf(userId: string): number | null {
  return parseKm(amounts.value[userId] ?? '')
}

function give(userId: string) {
  const fen = amountOf(userId)
  if (fen === null || fen <= 0 || props.busy) return
  emit('float', { userId, amountFen: fen })
  amounts.value = { ...amounts.value, [userId]: '' }
}
</script>

<template>
  <section class="card flex flex-col gap-3 p-4">
    <div>
      <h2 class="section-title">
        Dopuni smjenu
      </h2>
      <p class="text-label text-text-2">
        Sitno iz kase konobarima. Iznos ulazi u ono što taj konobar predaje na
        kraju smjene.
      </p>
    </div>

    <div v-for="waiter in waiters" :key="waiter.id" class="flex items-center gap-2">
      <span class="w-24 shrink-0 truncate text-body">{{ waiter.name }}</span>

      <div class="flex grow items-center gap-2 rounded-control border border-line bg-surface-2 px-3">
        <input
          v-model="amounts[waiter.id]"
          class="num min-h-12 w-full bg-transparent text-lg font-semibold outline-none"
          inputmode="decimal"
          autocomplete="off"
          placeholder="0,00"
          :aria-label="`Sitno za ${waiter.name}`"
        >
        <span class="shrink-0 text-label text-text-2">KM</span>
      </div>

      <button
        type="button"
        class="btn btn-primary min-h-12 shrink-0 px-4"
        :disabled="busy || parseKm(amounts[waiter.id] ?? '') === null"
        @click="give(waiter.id)"
      >
        Daj
      </button>
    </div>

    <p v-for="(fen, userId) in given" :key="userId" class="num text-sm text-good">
      Predano · {{ waiters.find(w => w.id === userId)?.name ?? '' }} · {{ formatKm(fen) }}
    </p>

    <p v-if="error" class="text-label text-danger">
      {{ error }}
    </p>
  </section>
</template>
