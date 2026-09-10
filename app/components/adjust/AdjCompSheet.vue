<script setup lang="ts">
/**
 * *Na račun kuće* (PLAN F7) — the sheet a long-press opens on a line the house
 * is paying for.
 *
 * It works on a line at either end of its life, and the difference is the whole
 * of the component's logic:
 *
 * - **`mode="draft"`** — the line is still on this phone, in the cart. Nothing is
 *   sent: the sheet hands the reason back and the round locks with
 *   `comp_reason` on that line, `charged_fen = 0` where it self-authorises. This
 *   is the cheap path and the common one, because a waiter usually knows the
 *   coffee is on the house *before* he sends it to the bar.
 * - **`mode="locked"`** — the round is already a ledger row, so the gratis is a
 *   `line_adjustments(kind='comp')` beside it, asked for exactly like a storno.
 *   The goods are never put back: the drink was made and drunk.
 *
 * **Osoblje is the only reason that authorises itself**, and only inside the
 * venue's published rule: the product has to be on the staff list, under
 * `staff_drink_max_fen`, and within `staff_drinks_per_shift`. The counter on
 * screen — *"Osoblje: 1/2 (do 3,00 KM)"* — is that rule made visible, which is
 * the whole point of publishing thresholds in *Pravila* rather than letting a
 * refusal explain them. Everything else locks at full price and waits for a
 * decision; `owner_guest` is the owner's alone, from his own phone.
 */
import { formatKm } from '#shared/money'
import {
  COMP_REASONS,
  type AdjustmentOutcome, type CompReason,
} from '~/composables/useAdjustments'

const props = withDefaults(defineProps<{
  mode: 'draft' | 'locked'
  /** The line, drafted or locked. `id` is the phone-minted line uuid. */
  line: { id: string, name: string, qty: number, amount_fen: number }
  tableName: string
  /** From the catalogue (§1.9). `null` when this build's bootstrap has no flag yet. */
  staffDrinkAllowed?: boolean | null
  /**
   * How many staff drinks he has had tonight, from `GET /api/me/shift`'s
   * `counts.gratis`. `null` renders the cap alone — the rule without the score,
   * which is still worth more than nothing (PHASE3 §1.5).
   */
  staffUsed?: number | null
  tabClientId?: string | null
}>(), { staffDrinkAllowed: null, staffUsed: null, tabClientId: null })

const emit = defineEmits<{
  close: []
  /** `mode="draft"`: put this reason on the cart line and let the lock carry it. */
  draft: [reason: CompReason]
  /** `mode="locked"`: the request is with the server, or on the queue. */
  done: [outcome: AdjustmentOutcome]
}>()

useSheetDismiss(() => emit('close'))

const me = useMe()
const {
  request, staffDrinkMaxFen, staffDrinksPerShift,
} = useAdjustments()

const reason = ref<CompReason | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)

const isAdmin = computed(() => me.user.value?.role === 'admin')

/** *Gost vlasnika* is the owner's word, and only from his own device. */
const reasons = computed(() => COMP_REASONS.filter(r => r.id !== 'owner_guest' || isAdmin.value))

const overCap = computed(() => props.line.amount_fen > staffDrinkMaxFen.value)
const outOfDrinks = computed(() =>
  props.staffUsed !== null && props.staffUsed >= staffDrinksPerShift.value)
const notOnList = computed(() => props.staffDrinkAllowed === false)

/** "Osoblje: 1/2 (do 3,00 KM)" — the published rule, with tonight's score in it. */
const staffCounter = computed(() => {
  const cap = `do ${formatKm(staffDrinkMaxFen.value)}`
  return props.staffUsed === null
    ? `Osoblje: ${staffDrinksPerShift.value} po smjeni (${cap})`
    : `Osoblje: ${props.staffUsed}/${staffDrinksPerShift.value} (${cap})`
})

/** Why this particular staff drink will not be free, in one sentence. */
const staffRefusal = computed<string | null>(() => {
  if (reason.value !== 'staff_drink') return null
  if (notOnList.value) return 'Ovo piće nije na listi za osoblje — ide na odobrenje.'
  if (overCap.value) {
    return `Skuplje od ${formatKm(staffDrinkMaxFen.value)} — ide na odobrenje.`
  }
  if (outOfDrinks.value) {
    return `Iskoristio si ${staffDrinksPerShift.value} od ${staffDrinksPerShift.value} za ovu smjenu`
      + ' — ide na odobrenje.'
  }
  return null
})

/** What happens on *Potvrdi*, said before it is tapped. */
const outlook = computed(() => {
  if (!reason.value) return null
  if (reason.value === 'staff_drink' && !staffRefusal.value) {
    return { tone: 'good' as const, text: 'U okviru dozvole — stavka ide na 0,00 KM odmah.' }
  }
  if (reason.value === 'owner_guest' && isAdmin.value) {
    return { tone: 'good' as const, text: 'Vlasnik odobrava sa svog telefona — odmah.' }
  }
  return {
    tone: 'warn' as const,
    text: `Naplaćuje se puna cijena dok se ne odobri — ${formatKm(props.line.amount_fen)}`
      + ' ostaje u tvom pazaru.',
  }
})

async function confirm() {
  if (!reason.value || busy.value) return

  if (props.mode === 'draft') {
    // Nothing is sent: the reason rides on the line and the lock decides.
    emit('draft', reason.value)
    return
  }

  busy.value = true
  error.value = null
  try {
    const outcome = await request({
      order_line_id: props.line.id,
      kind: 'comp',
      reason: reason.value,
      ...(props.tabClientId ? { tab_client_id: props.tabClientId } : {}),
      label: `${props.tableName} · ${props.line.name}`,
      amount_fen: props.line.amount_fen,
      facts: { mine: true },
    })
    emit('done', outcome)
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50">
    <div class="sheet-scrim" @click="emit('close')" />

    <div
      class="sheet-panel absolute inset-x-0 bottom-0 mx-auto flex max-h-[92dvh] w-full max-w-3xl flex-col gap-3 overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3"
      role="dialog"
      aria-label="Na račun kuće"
    >
      <span class="mx-auto h-1 w-10 shrink-0 rounded-full bg-line" />

      <div class="flex items-baseline gap-2">
        <h2 class="min-w-0 flex-1 truncate text-section font-bold">
          Na račun kuće
        </h2>
        <span class="num shrink-0 text-title font-bold">{{ formatKm(line.amount_fen) }}</span>
      </div>
      <p class="-mt-2 text-label text-text-2">
        {{ tableName }} · {{ line.qty }}× {{ line.name }}
      </p>

      <p v-if="error" class="note note-danger" role="alert">
        {{ error }}
      </p>

      <div class="flex flex-wrap gap-2">
        <button
          v-for="chip in reasons"
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

      <!-- The published rule, always on screen, not only when it refuses -->
      <p class="note num">
        {{ staffCounter }}
      </p>
      <p v-if="staffRefusal" class="note note-warn">
        {{ staffRefusal }}
      </p>

      <p
        v-if="outlook"
        class="rounded-control px-3 py-2 text-label"
        :class="outlook.tone === 'good' ? 'bg-good-soft text-good' : 'bg-warn-soft text-warn'"
      >
        {{ outlook.text }}
      </p>

      <button
        type="button"
        class="btn btn-primary btn-lg"
        :disabled="!reason || busy"
        @click="confirm"
      >
        {{ busy ? 'Šaljem…' : 'Kuća časti' }}
      </button>
      <button type="button" class="btn btn-ghost" :disabled="busy" @click="emit('close')">
        Otkaži
      </button>
    </div>
  </div>
</template>
