<script setup lang="ts">
/**
 * *Naplati* (S8) — the sheet that closes a table.
 *
 * The shape of it comes from what actually happens at a table: the guest hands
 * over a note, and the waiter needs the change in his head before he reaches
 * into his apron. So the buttons are the notes people pay with — 20, 50, 100 —
 * and the sheet does the subtraction. *Tačno* is the common case and sits first.
 *
 * Two rules from BACKEND §6.3 shape it:
 *
 * - **`amount_fen` is what the café keeps, `received_fen` is what the guest
 *   handed over.** Only the first one moves what is owed; the difference is the
 *   change. Neither is a price — the server priced the round at lock and this
 *   sheet has no idea what a coffee costs.
 * - **Card only when the venue takes cards.** `payment_methods` is a setting,
 *   and posting `card` to a café that has no terminal is 400 `METHOD_NOT_ALLOWED`
 *   — so the button is simply not drawn.
 *
 * *Nije plaćeno* lives here too, because it is the other way a table ends and
 * hiding it somewhere else would make walking out feel like something to hide.
 */
import { formatKm, parseKm } from '#shared/money'
import type { PaymentMethod } from '#shared/types'

const props = withDefaults(defineProps<{
  tableName: string
  /** What is still owed — the number this sheet is about. */
  remainingFen: number
  /** What the guests were charged in total, for the line above it. */
  totalFen: number
  /** From `venue.settings.payment_methods`. */
  methods: PaymentMethod[]
  busy?: boolean
  error?: string | null
}>(), { busy: false, error: null })

const emit = defineEmits<{
  close: []
  pay: [payment: { method: PaymentMethod, amount_fen: number, received_fen?: number }]
  unpaid: [reason: 'walked_out' | 'dispute' | 'other']
}>()

type Mode = 'main' | 'custom' | 'unpaid'
const mode = ref<Mode>('main')
const receivedRaw = ref('')

const cardAllowed = computed(() => props.methods.includes('card'))

/** The notes worth offering: only the ones bigger than the bill. */
const NOTES_FEN = [2000, 5000, 10_000]
const notes = computed(() => NOTES_FEN.filter(fen => fen > props.remainingFen))

const received = computed(() => parseKm(receivedRaw.value))
const customChange = computed(() => {
  const value = received.value
  if (value === null) return null
  return Math.max(0, value - props.remainingFen)
})
const customReady = computed(() => received.value !== null && received.value > 0 && !props.busy)

function payCash(receivedFen: number) {
  if (props.busy) return
  // A guest who hands over less than the bill has paid part of it: the tab stays
  // open for the rest rather than the sheet refusing him.
  const amount = Math.min(receivedFen, props.remainingFen)
  emit('pay', { method: 'cash', amount_fen: amount, received_fen: receivedFen })
}

function payExact() {
  payCash(props.remainingFen)
}

function payCard() {
  if (props.busy) return
  emit('pay', { method: 'card', amount_fen: props.remainingFen })
}

function payCustom() {
  if (!customReady.value || received.value === null) return
  payCash(received.value)
}

const UNPAID_REASONS = [
  { id: 'walked_out', label: 'Otišli bez plaćanja' },
  { id: 'dispute', label: 'Spor oko računa' },
  { id: 'other', label: 'Drugo' },
] as const
</script>

<template>
  <div class="fixed inset-0 z-50">
    <div class="absolute inset-0 bg-black/55" @click="emit('close')" />

    <div
      class="absolute inset-x-0 bottom-0 mx-auto flex max-h-[92dvh] w-full max-w-3xl flex-col gap-3 overflow-y-auto rounded-t-[20px] border-t border-line bg-surface px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3"
      role="dialog"
      aria-label="Naplata"
    >
      <span class="mx-auto h-1 w-10 shrink-0 rounded-full bg-line" />

      <div class="flex items-baseline gap-2">
        <h2 class="flex-1 truncate text-xl font-bold">
          {{ tableName }}
        </h2>
        <span class="num text-2xl font-bold">{{ formatKm(remainingFen) }}</span>
      </div>
      <p v-if="remainingFen !== totalFen" class="-mt-2 text-sm text-text-2">
        Od ukupno <span class="num">{{ formatKm(totalFen) }}</span> — ostatak duga.
      </p>

      <p v-if="error" class="rounded-xl bg-danger-soft px-3 py-2 text-[15px] text-danger" role="alert">
        {{ error }}
      </p>

      <!-- The notes people actually pay with -->
      <template v-if="mode === 'main'">
        <button type="button" class="btn btn-accent h-14 text-lg" :disabled="busy" @click="payExact">
          Tačno · <span class="num">{{ formatKm(remainingFen) }}</span>
        </button>

        <div v-if="notes.length" class="grid grid-cols-3 gap-2">
          <button
            v-for="note in notes"
            :key="note"
            type="button"
            class="btn h-14 flex-col gap-0 text-lg"
            :disabled="busy"
            @click="payCash(note)"
          >
            <span class="num">{{ formatKm(note) }}</span>
            <small class="num text-xs font-normal text-text-2">
              vrati {{ formatKm(note - remainingFen) }}
            </small>
          </button>
        </div>

        <button type="button" class="btn h-12" :disabled="busy" @click="mode = 'custom'">
          Drugi iznos
        </button>

        <button
          v-if="cardAllowed"
          type="button"
          class="btn h-12"
          :disabled="busy"
          @click="payCard"
        >
          Kartica
        </button>

        <div class="mt-1 flex flex-col gap-2 border-t border-line pt-3">
          <button type="button" class="btn btn-ghost h-12" :disabled="busy" @click="mode = 'unpaid'">
            Nije plaćeno
          </button>
          <button type="button" class="btn btn-ghost h-12" @click="emit('close')">
            Otkaži
          </button>
        </div>
      </template>

      <!-- Drugi iznos: what the guest handed over -->
      <template v-else-if="mode === 'custom'">
        <label class="flex flex-col gap-1.5">
          <span class="text-sm text-text-2">Koliko je gost dao?</span>
          <div class="card-2 flex h-16 items-center gap-2 px-3.5">
            <input
              v-model="receivedRaw"
              type="text"
              inputmode="decimal"
              placeholder="0,00"
              class="num min-w-0 flex-1 bg-transparent text-3xl font-semibold outline-none placeholder:text-muted"
            >
            <span class="shrink-0 text-text-2">KM</span>
          </div>
        </label>

        <p v-if="customChange !== null" class="num text-center text-lg">
          <span class="text-text-2">Vrati:</span> {{ formatKm(customChange) }}
        </p>
        <p v-if="received !== null && received < remainingFen" class="text-center text-[15px] text-warn">
          Manje od duga — sto ostaje otvoren za
          <span class="num">{{ formatKm(remainingFen - received) }}</span>.
        </p>

        <button type="button" class="btn btn-accent h-14 text-lg" :disabled="!customReady" @click="payCustom">
          {{ busy ? 'Naplaćujem…' : 'Naplati' }}
        </button>
        <button type="button" class="btn btn-ghost h-12" :disabled="busy" @click="mode = 'main'">
          Nazad
        </button>
      </template>

      <!-- Nije plaćeno: why -->
      <template v-else>
        <p class="text-[15px] text-text-2">
          Sto ostaje na tebi dok vlasnik ne odluči. Reci šta se desilo.
        </p>
        <button
          v-for="reason in UNPAID_REASONS"
          :key="reason.id"
          type="button"
          class="btn h-14 text-lg"
          :disabled="busy"
          @click="emit('unpaid', reason.id)"
        >
          {{ reason.label }}
        </button>
        <button type="button" class="btn btn-ghost h-12" :disabled="busy" @click="mode = 'main'">
          Nazad
        </button>
      </template>
    </div>
  </div>
</template>
