<script setup lang="ts">
/**
 * *Zatraži storno* (S2, PLAN F6) — the sheet a long-press on a locked line opens.
 *
 * It opens on the sentence that is the whole reason it exists: **"Zaključene
 * stavke se ne mijenjaju."** A locked round is a ledger row; nothing edits it.
 * What a waiter can do is ask for it to be struck, and the ask is a row of its
 * own with his name on it.
 *
 * Three things the sheet shows *before* anything is sent, because a waiter
 * should never learn what he did from the consequence:
 *
 *   1. **What it does to the shelf** — "Vraća robu na stanje: da / ne", from the
 *      reason chip. `wrong_entry`, `guest_changed_mind` and `not_served` put the
 *      goods back; a complaint does not, because the coffee was drunk.
 *   2. **Whether it applies itself** — his own line, on an unpaid tab, inside
 *      `void_self_window_s`. The countdown is on screen while it lasts.
 *   3. **Whose money it is until then** — "5,00 KM ostaje u tvom pazaru dok se ne
 *      odobri", which is the honest answer and the one that stops a waiter
 *      assuming a pending storno has already left his envelope.
 *
 * Sending is the composable's business (`useAdjustments`): PIN-less requests go
 * on the outbox, a PIN-bearing one posts directly and falls back to the queue
 * without the digits if the router is gone. This file only ever asks.
 */
import { useIntervalFn, useOnline } from '@vueuse/core'
import { formatKm } from '#shared/money'
import {
  NOTE_MIN_LENGTH, VOID_REASONS,
  type AdjustmentOutcome, type VoidReason,
} from '~/composables/useAdjustments'
// Explicit, not auto-imported. Nuxt names a component after its folder plus its
// file (`waiter/WaiterSyncChip.vue` → `WaiterSyncChip`, because the file already
// starts with the folder). `adjust/AdjPinSheet.vue` does not, so the
// auto-import would be `<AdjustAdjPinSheet>` — and an unresolved tag in a
// production build renders nothing at all, silently. Importing it by name is one
// line and cannot go quiet on a Saturday night.
import AdjPinSheet from '~/components/adjust/AdjPinSheet.vue'

const props = withDefaults(defineProps<{
  /** The locked line, exactly as the tab shows it. */
  line: { id: string, name: string, qty: number, amount_fen: number }
  tableName: string
  /** `orders.created_at` of the round it belongs to — the window is measured from it. */
  lockedAt?: string | null
  /** Did this person lock the round? A self-void is only ever your own line. */
  mine?: boolean
  /** A paid tab is never a self-void; the money has already changed hands. */
  tabPaid?: boolean
  /** What a failure blocks. The same id the payment on this table would carry. */
  tabClientId?: string | null
}>(), { lockedAt: null, mine: false, tabPaid: false, tabClientId: null })

const emit = defineEmits<{
  close: []
  /** Sent (or queued). The parent shows the message and re-reads the tab. */
  done: [outcome: AdjustmentOutcome]
}>()

useSheetDismiss(() => emit('close'))

const {
  request, approvers, approverName, loadApprovers, selfWindowS,
} = useAdjustments()
const online = useOnline()
const { state: syncState } = useSync()

type Step = 'reason' | 'pin'
const step = ref<Step>('reason')
const reason = ref<VoidReason | null>(null)
const note = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

// The countdown has to move while the sheet is open: a waiter who hesitates for
// forty seconds must see the self-void window close rather than tap a button
// that quietly changed meaning under his thumb.
const nowMs = ref(Date.now())
useIntervalFn(() => { nowMs.value = Date.now() }, 1000)

const chosen = computed(() => VOID_REASONS.find(r => r.id === reason.value) ?? null)
const restocks = computed(() => chosen.value?.restock === true)

/** *Drugo* says nothing on its own, so it has to be written out. */
const noteRequired = computed(() => reason.value === 'other')
const noteOk = computed(() => !noteRequired.value || note.value.trim().length >= NOTE_MIN_LENGTH)
const ready = computed(() => reason.value !== null && noteOk.value && !busy.value)

const ageS = computed(() => {
  if (!props.lockedAt) return null
  const ms = Date.parse(props.lockedAt)
  return Number.isFinite(ms) ? Math.max(0, Math.floor((nowMs.value - ms) / 1000)) : null
})

/** His own line, unpaid tab, inside the window: it applies the moment it lands. */
const selfVoid = computed(() => (
  props.mine === true
  && props.tabPaid !== true
  && ageS.value !== null
  && ageS.value <= selfWindowS.value
))

const selfLeftS = computed(() => (
  selfVoid.value && ageS.value !== null ? selfWindowS.value - ageS.value : 0
))

function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Is the phone in a state where an approver's PIN can actually be checked? */
const canAskPin = computed(() => online.value && syncState.value !== 'offline')

const facts = computed(() => ({
  locked_at: props.lockedAt,
  mine: props.mine,
  tab_paid: props.tabPaid,
}))

async function send(approver?: { user_id: string, pin: string }) {
  if (!reason.value || busy.value) return
  busy.value = true
  error.value = null
  try {
    const outcome = await request({
      order_line_id: props.line.id,
      kind: 'void',
      reason: reason.value,
      ...(note.value.trim() ? { note: note.value.trim() } : {}),
      ...(props.tabClientId ? { tab_client_id: props.tabClientId } : {}),
      label: `${props.tableName} · ${props.line.name}`,
      amount_fen: props.line.amount_fen,
      ...(approver ? { approver } : {}),
      facts: facts.value,
    })
    emit('done', outcome)
  } catch (err) {
    // A 4xx the person can answer: a wrong PIN, a line somebody already struck.
    error.value = apiErrorText(err)
  } finally {
    busy.value = false
  }
}

/** *Zatraži storno*: straight through when it applies itself, else ask for a PIN. */
async function confirm() {
  if (!ready.value) return
  if (selfVoid.value || !canAskPin.value) {
    await send()
    return
  }
  await loadApprovers()
  step.value = 'pin'
}
</script>

<template>
  <div class="fixed inset-0 z-50">
    <div class="sheet-scrim" @click="emit('close')" />

    <div
      class="sheet-panel absolute inset-x-0 bottom-0 mx-auto flex max-h-[92dvh] w-full max-w-3xl flex-col gap-3 overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3"
      role="dialog"
      aria-label="Zatraži storno"
    >
      <span class="mx-auto h-1 w-10 shrink-0 rounded-full bg-line" />

      <div class="flex items-baseline gap-2">
        <h2 class="min-w-0 flex-1 truncate text-xl font-bold">
          {{ line.qty }}× {{ line.name }}
        </h2>
        <span class="num shrink-0 text-2xl font-bold">{{ formatKm(line.amount_fen) }}</span>
      </div>
      <p class="-mt-2 text-label text-text-2">
        {{ tableName }} · zaključene stavke se ne mijenjaju — možeš zatražiti storno.
      </p>

      <p v-if="error" class="note note-danger" role="alert">
        {{ error }}
      </p>

      <template v-if="step === 'reason'">
        <!-- Why -->
        <div class="flex flex-wrap gap-2">
          <button
            v-for="chip in VOID_REASONS"
            :key="chip.id"
            type="button"
            class="pill h-12"
            :class="reason === chip.id
              ? 'pill-on'
              : ''"
            @click="reason = chip.id"
          >
            {{ chip.label }}
          </button>
        </div>

        <label v-if="noteRequired" class="flex flex-col gap-1.5">
          <span class="text-label text-text-2">Napiši šta se desilo (najmanje {{ NOTE_MIN_LENGTH }} znakova)</span>
          <textarea
            v-model="note"
            rows="2"
            maxlength="200"
            class="card-2 min-h-12 w-full resize-none px-3.5 py-2.5 text-body outline-none placeholder:text-muted"
            placeholder="Kratko, svojim riječima"
          />
        </label>

        <!-- What it does to the shelf, before anything is sent -->
        <p v-if="chosen" class="note">
          Vraća robu na stanje:
          <span :class="restocks ? 'font-semibold text-good' : 'font-semibold text-text-2'">
            {{ restocks ? 'da' : 'ne' }}
          </span>
        </p>

        <!-- What will happen to it -->
        <p v-if="selfVoid" class="note note-good">
          Tvoja stavka, u roku — storno se odmah primjenjuje.
          <span class="num">Još {{ mmss(selfLeftS) }}.</span>
        </p>
        <p v-else-if="!canAskPin" class="note note-warn">
          Nema veze — ide na čekanje, {{ approverName }} potvrđuje sa svog telefona.
        </p>
        <p v-else class="note note-warn">
          Ide na odobrenje. {{ formatKm(line.amount_fen) }} ostaje u tvom pazaru dok se ne odobri.
        </p>

        <button
          type="button"
          class="btn btn-primary btn-lg"
          :disabled="!ready"
          @click="confirm"
        >
          {{ busy ? 'Šaljem…' : 'Zatraži storno' }}
        </button>
        <button type="button" class="btn btn-ghost" :disabled="busy" @click="emit('close')">
          Otkaži
        </button>
      </template>
    </div>

    <!-- The approver's PIN, on this phone -->
    <AdjPinSheet
      v-if="step === 'pin'"
      :approvers="approvers"
      :what="`Storno · ${line.name} · ${formatKm(line.amount_fen)}`"
      :busy="busy"
      :error="error"
      @close="step = 'reason'"
      @skip="send()"
      @submit="send"
    />
  </div>
</template>
