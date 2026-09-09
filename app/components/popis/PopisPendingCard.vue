<script setup lang="ts">
/**
 * The refusal that names the phone (F9 step 2).
 *
 * A count is a reading of the shelf at one instant. A round still sitting in
 * somebody's outbox happened *before* that instant and will land after it, and
 * the difference would be read as shrinkage — somebody's shortage, on paper,
 * because a phone was behind the fridge. So the server refuses, and the useful
 * half of the refusal is *whose* phone: "Amarov telefon se javio prije 3 min, 2
 * neposlane" is something a bartender can act on. "Pokušaj kasnije" is not.
 *
 * A phone nobody has heard from in an hour never blocks anything — that one is
 * reported on the submitted count instead (`stale_devices`).
 */
import type { StaleDevice } from '#shared/types'

defineProps<{ devices: StaleDevice[], busy?: boolean }>()
defineEmits<{ retry: [] }>()

/** "prije 3 min" — how long ago that phone last said anything. */
function lastSeen(iso: string | null): string {
  if (!iso) return 'nije se javio'
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (seconds < 60) return `javio se prije ${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `javio se prije ${minutes} min`
  return `javio se prije ${Math.floor(minutes / 60)} h`
}

/** 1 → "1 neposlana", 2–4 → "2 neposlane", else "5 neposlanih". */
function unsent(n: number): string {
  const ones = n % 10
  const tens = n % 100
  if (ones === 1 && tens !== 11) return `${n} neposlana`
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return `${n} neposlane`
  return `${n} neposlanih`
}
</script>

<template>
  <div class="card border-warn p-4">
    <h3 class="flex items-center gap-2 text-lg font-semibold text-warn">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <path d="M12 8v5M12 16.5v.01M10.3 3.9L2.6 17.2A1.6 1.6 0 004 19.6h16a1.6 1.6 0 001.4-2.4L13.7 3.9a1.6 1.6 0 00-2.8 0z" />
      </svg>
      Popis još ne može
    </h3>

    <p class="mt-1 text-[15px] text-text-2">
      Neko još ima neposlane ture na telefonu, pa bi popis pokazao manjak kojeg
      nema.
    </p>

    <p v-for="device in devices" :key="device.device_id" class="mt-2 text-[17px]">
      {{ device.label }} · {{ lastSeen(device.last_seen_at) }},
      {{ unsent(device.pending_count) }}
    </p>

    <button
      type="button"
      class="btn btn-accent mt-3 min-h-12 w-full"
      :disabled="busy"
      @click="$emit('retry')"
    >
      Pokušaj ponovo
    </button>
  </div>
</template>
