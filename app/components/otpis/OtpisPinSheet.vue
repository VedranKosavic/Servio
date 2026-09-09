<script setup lang="ts">
/**
 * The approver's PIN, typed on the spot (S13, F9's sibling).
 *
 * A big otpis is not refused — the bottle is broken either way and a refusal
 * only teaches staff to stop logging breakage. What the threshold buys is a
 * *witness*: the šanker standing at the bar types his four or six digits on this
 * phone and the entry is acknowledged in the same request. Without him it saves
 * anyway, marked *čeka odobrenje*, and the owner sees it in the morning.
 *
 * The PIN never travels except over a live connection: if the phone is offline
 * the sheet is not offered at all (see `otpis.vue`), because a queued entry
 * waits on disk and a PIN has no business sitting there.
 */
import { formatKm } from '#shared/money'
import type { User } from '#shared/types'

const props = defineProps<{
  approvers: User[]
  itemName: string
  costFen: number
  busy?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  approve: [{ approverId: string, pin: string }]
  skip: []
  close: []
}>()

const approverId = ref<string | null>(props.approvers[0]?.id ?? null)
const pin = ref('')

const canSend = computed(() =>
  !!approverId.value && pin.value.length >= 4 && !props.busy)

function press(digit: string) {
  if (pin.value.length >= 6) return
  pin.value += digit
}

function submit() {
  if (!canSend.value) return
  emit('approve', { approverId: approverId.value!, pin: pin.value })
}
</script>

<template>
  <div class="fixed inset-0 z-40 bg-black/60" @click="emit('close')" />

  <div
    class="fixed inset-x-0 bottom-0 z-50 flex max-h-[92vh] flex-col gap-3 overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    role="dialog"
    aria-label="Odobrenje otpisa"
  >
    <div>
      <h2 class="text-xl font-bold">
        Otpis traži odobrenje
      </h2>
      <p class="num text-[15px] text-text-2">
        {{ itemName }} · {{ formatKm(costFen) }}
      </p>
    </div>

    <div class="flex flex-wrap gap-2">
      <button
        v-for="person in approvers"
        :key="person.id"
        type="button"
        class="min-h-12 rounded-full border px-4 text-base font-semibold"
        :class="approverId === person.id
          ? 'border-accent bg-accent text-accent-ink'
          : 'border-line bg-surface-2 text-text-2'"
        @click="approverId = person.id"
      >
        {{ person.name }}
      </button>
    </div>

    <div class="flex min-h-13 items-center gap-2 rounded-xl border border-line bg-surface-2 px-3">
      <span class="num grow text-2xl font-bold tracking-[0.4em]">
        {{ '•'.repeat(pin.length) }}
      </span>
      <button
        type="button"
        class="text-sm text-text-2"
        aria-label="Obriši"
        @click="pin = pin.slice(0, -1)"
      >
        Obriši
      </button>
    </div>

    <div class="grid grid-cols-3 gap-2">
      <button
        v-for="digit in ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']"
        :key="digit"
        type="button"
        class="btn min-h-14 text-xl"
        :class="digit === '0' ? 'col-start-2' : ''"
        @click="press(digit)"
      >
        {{ digit }}
      </button>
    </div>

    <p v-if="error" class="text-[15px] text-danger">
      {{ error }}
    </p>

    <button type="button" class="btn btn-accent min-h-14 text-lg" :disabled="!canSend" @click="submit">
      Odobri i sačuvaj
    </button>

    <button type="button" class="btn btn-ghost min-h-13" :disabled="busy" @click="emit('skip')">
      Sačuvaj bez odobrenja
    </button>
    <p class="text-center text-sm text-muted">
      Bez odobrenja otpis se svejedno upisuje — vlasnik ga vidi kao "čeka
      potvrdu".
    </p>
  </div>
</template>
