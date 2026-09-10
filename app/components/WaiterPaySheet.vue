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
  /**
   * Which half the sheet opens on. ⋯ → *Nije plaćeno* comes straight here, so
   * a guest who walked out costs the same two taps as one who paid.
   */
  initialMode?: 'main' | 'unpaid'
  busy?: boolean
  error?: string | null
}>(), { initialMode: 'main', busy: false, error: null })

const emit = defineEmits<{
  close: []
  pay: [payment: { method: PaymentMethod, amount_fen: number, received_fen?: number }]
  unpaid: [reason: 'walked_out' | 'dispute' | 'other']
}>()

useSheetDismiss(() => emit('close'))

type Mode = 'main' | 'custom' | 'unpaid'
const mode = ref<Mode>(props.initialMode)
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
    <div class="sheet-scrim" @click="emit('close')" />

    <div class="absolute inset-x-0 bottom-0 mx-auto w-full max-w-3xl">
      <div
        class="sheet-panel flex max-h-[92dvh] flex-col gap-3 overflow-y-auto px-4 pb-5 pt-3"
        role="dialog"
        aria-label="Naplata"
      >
        <span class="mx-auto h-1 w-10 shrink-0 rounded-chip bg-line" aria-hidden="true" />

        <!-- What the sheet is about, at the size the sheet is about it. -->
        <header class="flex flex-col gap-1 pb-1">
          <p class="eyebrow truncate">
            {{ tableName }}
          </p>
          <p class="metric num">
            {{ formatKm(remainingFen) }}
          </p>
          <p v-if="remainingFen !== totalFen" class="num text-label text-text-2">
            Od ukupno {{ formatKm(totalFen) }} — ostatak duga.
          </p>
        </header>

        <p v-if="error" class="note note-danger" role="alert">
          {{ error }}
        </p>

        <!-- The notes people actually pay with -->
        <template v-if="mode === 'main'">
          <button type="button" class="btn btn-primary btn-lg" :disabled="busy" @click="payExact">
            Tačno · <span class="num">{{ formatKm(remainingFen) }}</span>
          </button>

          <div v-if="notes.length" class="grid grid-cols-3 gap-2.5">
            <button
              v-for="note in notes"
              :key="note"
              type="button"
              class="note-btn"
              :disabled="busy"
              @click="payCash(note)"
            >
              <span class="num note-value">{{ formatKm(note) }}</span>
              <small class="num note-change">vrati {{ formatKm(note - remainingFen) }}</small>
            </button>
          </div>

          <div class="flex flex-col gap-2.5">
            <button type="button" class="btn btn-secondary" :disabled="busy" @click="mode = 'custom'">
              Drugi iznos
            </button>

            <button
              v-if="cardAllowed"
              type="button"
              class="btn btn-secondary"
              :disabled="busy"
              @click="payCard"
            >
              Kartica
            </button>
          </div>

          <div class="mt-1 flex flex-col gap-2.5 border-t border-line-soft pt-3">
            <button type="button" class="btn btn-ghost" :disabled="busy" @click="mode = 'unpaid'">
              Nije plaćeno
            </button>
            <button type="button" class="btn btn-ghost" @click="emit('close')">
              Otkaži
            </button>
          </div>
        </template>

        <!-- Drugi iznos: what the guest handed over -->
        <template v-else-if="mode === 'custom'">
          <label class="flex flex-col gap-2">
            <span class="eyebrow">Koliko je gost dao</span>
            <span class="input input-num flex items-center gap-2 px-4">
              <input
                v-model="receivedRaw"
                type="text"
                inputmode="decimal"
                placeholder="0,00"
                aria-label="Koliko je gost dao"
                class="num min-w-0 flex-1 bg-transparent text-right text-title font-semibold outline-none placeholder:text-muted"
              >
              <span class="shrink-0 text-label font-normal text-text-2">KM</span>
            </span>
          </label>

          <p v-if="customChange !== null" class="note text-center">
            <span class="text-text-2">Vrati</span>
            <span class="num ml-1 font-semibold text-text">{{ formatKm(customChange) }}</span>
          </p>
          <p v-if="received !== null && received < remainingFen" class="note note-warn">
            Manje od duga — sto ostaje otvoren za
            <span class="num font-semibold">{{ formatKm(remainingFen - received) }}</span>.
          </p>

          <button type="button" class="btn btn-primary btn-lg" :disabled="!customReady" @click="payCustom">
            {{ busy ? 'Naplaćujem…' : 'Naplati' }}
          </button>
          <button type="button" class="btn btn-ghost" :disabled="busy" @click="mode = 'main'">
            Nazad
          </button>
        </template>

        <!-- Nije plaćeno: why -->
        <template v-else>
          <p class="note">
            Sto ostaje na tebi dok vlasnik ne odluči. Reci šta se desilo.
          </p>
          <button
            v-for="reason in UNPAID_REASONS"
            :key="reason.id"
            type="button"
            class="btn btn-secondary btn-lg justify-start"
            :disabled="busy"
            @click="emit('unpaid', reason.id)"
          >
            {{ reason.label }}
          </button>
          <button type="button" class="btn btn-ghost" :disabled="busy" @click="mode = 'main'">
            Nazad
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
/**
 * A note button is not a plain `.btn`: it carries two lines — what the guest
 * hands over, and what goes back — and the change is the line that stops a
 * waiter doing arithmetic in his head at one in the morning.
 */
.note-btn {
  display: flex;
  min-height: 64px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 8px 6px;
  border-radius: var(--radius-control);
  border: 1px solid var(--line);
  background: var(--surface-2);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-standard),
    transform var(--dur-tap) var(--ease-standard);
}

.note-btn:active:not(:disabled) { transform: scale(0.97); }
.note-btn:disabled { opacity: 0.45; cursor: default; }

.note-value {
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--ink);
}

.note-change {
  font-size: var(--text-caption);
  letter-spacing: 0.01em;
  color: var(--muted);
}
</style>
