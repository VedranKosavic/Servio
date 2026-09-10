<script setup lang="ts">
/**
 * `/konobar/otpis` — S13. Item → koliko → razlog → *Sačuvaj*. Four taps.
 *
 * **It writes the ledger, so it goes through the outbox.** An otpis is a stock
 * movement exactly like a round is: `enqueue('waste', …)` hands back the local
 * truth immediately and the store gets it to the server eventually, in order,
 * exactly once. There is no second send path on this screen — the only place
 * that posts is the outbox's flush.
 *
 * **The threshold buys a witness, never a refusal.** Above
 * `waste_pin_threshold_fen` the approver's PIN sheet appears; skipping it saves
 * the otpis anyway and says so, because a café where breakage is refused is a
 * café where breakage stops being logged, and that is the version that costs
 * the owner real money (PLAN §14.10).
 *
 * **A waiter writes what is visibly an accident.** `razbijeno` and `prosuto`
 * are his; *isteklo*, *degustacija* and *ostalo* are the šanker's, and the
 * server says so too (`REASON_FORBIDDEN`) — the chips are drawn disabled rather
 * than hidden, so nobody wonders where they went.
 */
import { useTimeoutFn } from '@vueuse/core'
import { formatKm } from '#shared/money'
import type { LogWasteBody, StockItem, WasteReason } from '#shared/types'

useHead({ title: 'Otpis' })

const me = useMe()
const { enqueue } = useOutbox()
const { state: syncState } = useSync()

const items = ref<StockItem[]>([])
useChanges({
  stock: (list) => { items.value = list },
  me: () => me.load(),
}, { intervalMs: 15_000 })

onMounted(async () => {
  await me.requireSession()
  // The approver list is `GET /api/auth/users` — the lock screen's own read,
  // device-scoped and carrying `pin_len`. Fetched once, not on the poll.
  await loadApprovers()
})

const REASONS: { key: WasteReason, label: string, waiter: boolean }[] = [
  { key: 'razbijeno', label: 'razbijeno', waiter: true },
  { key: 'isteklo', label: 'isteklo', waiter: false },
  { key: 'prosuto', label: 'prosuto', waiter: true },
  { key: 'degustacija', label: 'degustacija', waiter: false },
  { key: 'ostalo', label: 'ostalo', waiter: false },
]

const selected = ref<StockItem | null>(null)
const qtyRaw = ref('1')
const reason = ref<WasteReason | null>(null)
const note = ref('')

const qty = computed(() => parseDecimalInput(qtyRaw.value))

/** Whoever the settings say approves money — the šanker, and the owner. */
const isApprover = computed(() =>
  me.user.value?.role === 'admin' || me.mode.value === 'sanker')

/**
 * Who may be asked for a PIN here — the shared list, not a filter of our own.
 *
 * `useAdjustments().approvers` applies all three of the server's rules: the
 * venue's `approver_roles`, never the person holding the phone, and never the
 * owner unless this is his own bound device (`ADMIN_PIN_FOREIGN_DEVICE` refuses
 * that one). It also carries `pin_len`, so the pad knows how many digits to
 * expect.
 */
const { approvers, loadApprovers } = useAdjustments()

function allowed(entry: (typeof REASONS)[number]): boolean {
  return entry.waiter || isApprover.value
}

/**
 * What this will cost the shelf, as the phone can best guess it.
 *
 * It is an estimate and is labelled one: the server prices the movement from
 * the moving average at the moment it lands, and that is the number that ends
 * up in the ledger. This one exists only to decide whether to offer the PIN
 * sheet and to tell the person what he is about to write.
 */
const estimateFen = computed(() => {
  if (!selected.value || qty.value === null) return 0
  return Math.round((qty.value * selected.value.unit_cost_mfen) / 1000)
})

const threshold = computed(() => me.settings.value?.waste_pin_threshold_fen ?? 1000)
const needsApproval = computed(() => estimateFen.value >= threshold.value)

const canSave = computed(() =>
  !!selected.value && qty.value !== null && qty.value > 0 && !!reason.value && !saving.value)

const pinOpen = ref(false)
const saving = ref(false)
const saveError = ref<string | null>(null)
const toast = ref<string | null>(null)
const { start: hideToastLater } = useTimeoutFn(() => { toast.value = null }, 3000, { immediate: false })

function onSave() {
  if (!canSave.value) return
  // Offline the sheet is not offered: a queued entry waits on disk, and a PIN
  // has no business waiting anywhere. The otpis still saves, and still says it
  // is waiting for a yes.
  if (needsApproval.value && approvers.value.length > 0 && syncState.value !== 'offline') {
    pinOpen.value = true
    return
  }
  void save(null)
}

async function save(approval: { approverId: string, pin: string } | null) {
  const item = selected.value
  if (!item || qty.value === null || !reason.value || saving.value) return

  saving.value = true
  saveError.value = null
  try {
    const body: LogWasteBody = {
      // The idempotency key: the same uuid on every retry, which is what makes
      // a re-sent otpis one broken bottle instead of two.
      client_id: crypto.randomUUID(),
      stock_item_id: item.id,
      qty: qty.value,
      reason: reason.value,
      client_created_at: new Date().toISOString(),
      ...(note.value.trim() ? { note: note.value.trim() } : {}),
      ...(approval ? { approver_user_id: approval.approverId, pin: approval.pin } : {}),
    }

    await enqueue({
      kind: 'waste',
      client_id: body.client_id,
      payload: body,
      client_created_at: body.client_created_at,
      label: `Otpis · ${item.name}`,
      amount_fen: estimateFen.value,
    })

    toast.value = syncState.value === 'offline'
      ? `Sačuvano · čeka slanje · ${item.name}`
      : `Otpisano · ${item.name}`
    if (!approval && needsApproval.value) toast.value += ' · čeka odobrenje'
    hideToastLater()

    pinOpen.value = false
    selected.value = null
    qtyRaw.value = '1'
    reason.value = null
    note.value = ''
  } catch (err) {
    saveError.value = apiErrorText(err, 'Otpis nije sačuvan.')
  } finally {
    saving.value = false
  }
}

function step(delta: number) {
  const current = qty.value ?? 0
  qtyRaw.value = String(Math.max(0, Math.round((current + delta) * 100) / 100))
}
</script>

<template>
  <div class="flex flex-1 flex-col">
    <!-- The bartender writes off from behind the bar, so his arrow goes back
         to the ticket queue rather than to a floor plan he does not use. -->
    <WaiterHeader title="Otpis" :back-to="me.home.value">
      <template #right>
        <WaiterSyncChip />
      </template>
    </WaiterHeader>

    <WaiterOutboxBanner />

    <main class="flex flex-1 flex-col gap-4 py-4">
      <WaiterFailedCard />

      <OtpisItemPicker
        v-if="!selected"
        :items="items"
        :selected-id="selected?.id ?? null"
        @select="selected = $event"
      />

      <template v-else>
        <div class="card flex items-center justify-between gap-3 p-4">
          <div>
            <div class="section-title">
              {{ selected.name }}
            </div>
            <div class="num text-label text-text-2">
              {{ formatKm(estimateFen) }}
              <template v-if="selected.estimated"> · procijenjeno</template>
            </div>
          </div>
          <button type="button" class="btn btn-ghost" @click="selected = null">
            Promijeni
          </button>
        </div>

        <section class="flex flex-col gap-2">
          <h2 class="section-title">
            Koliko
          </h2>
          <div class="flex items-stretch gap-2">
            <button type="button" class="btn btn-secondary min-h-15 w-15 shrink-0" aria-label="Manje" @click="step(-1)">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12" /></svg>
            </button>
            <span class="input input-num flex grow items-center gap-2 px-3">
              <input
                v-model="qtyRaw"
                class="num w-full bg-transparent text-center text-title font-semibold outline-none"
                inputmode="decimal"
                autocomplete="off"
                aria-label="Količina"
              >
              <span class="shrink-0 text-label font-normal text-text-2">{{ selected.base_unit }}</span>
            </span>
            <button type="button" class="btn btn-secondary min-h-15 w-15 shrink-0" aria-label="Više" @click="step(1)">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 6v12M6 12h12" /></svg>
            </button>
          </div>
        </section>

        <section class="flex flex-col gap-2">
          <h2 class="section-title">
            Razlog
          </h2>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="entry in REASONS"
              :key="entry.key"
              type="button"
              class="pill h-12"
              :class="reason === entry.key ? 'pill-on' : ''"
              :disabled="!allowed(entry)"
              @click="reason = entry.key"
            >
              {{ entry.label }}
            </button>
          </div>
          <p v-if="!isApprover" class="text-label text-text-2">
            Isteklo, degustaciju i ostalo upisuje šanker.
          </p>
        </section>

        <input
          v-model="note"
          class="input"
          placeholder="Napomena (nije obavezna)"
          maxlength="200"
          aria-label="Napomena"
        >

        <p v-if="needsApproval" class="note note-warn">
          Ovaj otpis traži odobrenje šankera ili vlasnika.
        </p>

        <p v-if="saveError" class="note note-danger" role="alert">
          {{ saveError }}
        </p>
      </template>

      <p class="pb-24 text-center text-caption tracking-normal text-muted">
        Otpis odmah skida robu sa stanja. Odobrenje je potvrda, ne dozvola.
      </p>
    </main>

    <div v-if="selected" class="action-bar -mx-4 border-t border-line px-4">
      <button
        type="button"
        class="btn btn-primary btn-lg w-full"
        :disabled="!canSave"
        @click="onSave"
      >
        Sačuvaj
      </button>
    </div>

    <OtpisPinSheet
      v-if="pinOpen && selected"
      :approvers="approvers"
      :item-name="selected.name"
      :cost-fen="estimateFen"
      :busy="saving"
      :error="saveError"
      @approve="save"
      @skip="save(null)"
      @close="pinOpen = false"
    />

    <div v-if="toast" class="toast" role="status" @click="toast = null">
      {{ toast }}
    </div>
  </div>
</template>
