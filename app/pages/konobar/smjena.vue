<script setup lang="ts">
/**
 * *Završi smjenu* (S9) — the blind cash settlement.
 *
 * **The order of the two numbers is the whole design.** The waiter counts what
 * is in his apron and types it; only then does the server say what it expected.
 * `declared_fen` is written to the ledger *before* any `*_fen` for that person
 * leaves the server (BACKEND §6.6), which is why this screen must never render
 * an expected amount it did not get back from the settle response — and why
 * `GET /api/me/shift` answers `summary: null` until a settlement row exists.
 *
 * Blindness is a nudge, not a control: anyone who can add knows his own number
 * from his own rounds. What the café gets out of it is the *recorded pair* —
 * declared and expected, side by side, written in the same transaction — not a
 * secret. Say so out loud rather than pretending otherwise, which is what the
 * line under the input does.
 *
 * There is exactly one end-of-shift flow in this app and this is it (CLAUDE.md);
 * anything else the closing needs is extended here, never added beside it.
 */
import { formatKm, parseKm } from '#shared/money'
import type { MyShift, SettleResult } from '#shared/types'
import { ApiSideError } from '~/composables/useApi'

useHead({ title: 'Završi smjenu' })

const api = useApi()
const me = useMe()
useOutbox()
const { blocked, blockedText, pending } = useSync()

const shift = ref<MyShift | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)

/** The reveal, and the only place an expected amount may come from. */
const reveal = ref<SettleResult | null>(null)

const declaredRaw = ref('')
const settling = ref(false)
const settleError = ref<string | null>(null)
/** Phones of this person that still report an outbox — a 409 `PENDING_OUTBOX`. */
const stuckDevices = ref<{ label: string, pending_count: number }[]>([])

onMounted(async () => {
  if (!(await me.requireSession())) return
  await load()
})

async function load() {
  loading.value = true
  loadError.value = null
  try {
    shift.value = await api.getMyShift()
  } catch (err) {
    if (!(await me.handleAuthError(err))) loadError.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

const brief = computed(() => shift.value?.shift ?? null)
const settled = computed(() => shift.value?.settled === true)
const myOpenTabs = computed(() => brief.value?.my_open_tabs ?? 0)

/**
 * The checklist. Both rows are conditions the *server* also enforces — an open
 * tab is not refused by settle, but it is money still walking around, and an
 * unsent round would change the number under discussion a minute after it was
 * agreed (§6.6). Showing them here means the refusal is never a surprise.
 */
const checklist = computed(() => [
  {
    ok: myOpenTabs.value === 0,
    // The label states what is actually true, never the happy case beside an
    // amber marker: colour must not be the only thing carrying the meaning.
    label: myOpenTabs.value === 0
      ? 'Svi tvoji stolovi naplaćeni'
      : `Nenaplaćenih stolova: ${myOpenTabs.value}`,
    detail: myOpenTabs.value === 0
      ? 'Nema otvorenih stolova kod tebe.'
      : `Otvorenih kod tebe: ${myOpenTabs.value}. Naplati ih prije predaje.`,
  },
  {
    // There is no offline outbox yet (it lands later in Phase 3), so this is
    // honestly always true — and stays a row, because the day the outbox exists
    // it is the row that explains a refusal.
    ok: true,
    label: 'Sve narudžbe poslane',
    detail: 'Ništa ne čeka na slanje s ovog telefona.',
    // When the outbox lands, this row states the count the same way the one
    // above does: `Čeka na slanje: n`.
  },
])

const declared = computed(() => parseKm(declaredRaw.value))
const canSettle = computed(() =>
  !!brief.value && declared.value !== null && declared.value >= 0 && !settling.value
  // The server already refuses this with `409 PENDING_OUTBOX`, but a waiter
  // standing at the till with the envelope in his hand should be told *before*
  // the request leaves, not after a round trip that fails.
  && !blocked.value)

async function settle() {
  const shiftId = brief.value?.id
  if (!shiftId || declared.value === null || settling.value) return

  if (blocked.value) {
    settleError.value = `${blockedText.value} — sačekaj da odu.`
    return
  }

  settling.value = true
  settleError.value = null
  stuckDevices.value = []
  try {
    reveal.value = await api.settleShift(shiftId, {
      declared_fen: declared.value,
      // The phone's own count of rounds it has not managed to send. Zero by the
      // time we get here — the guard above saw to that — but reported honestly
      // rather than hard-coded, which is the only way it is worth reporting.
      outbox_len: pending.value,
    })
    // The strip drops the moment a settlement exists: re-read it for the
    // summary, the movements and the accepted-by line.
    await load()
  } catch (err) {
    const e = err as ApiSideError
    if (e.code === 'PENDING_OUTBOX') {
      stuckDevices.value = (e.data.devices as typeof stuckDevices.value) ?? []
    }
    settleError.value = apiErrorText(err)
    void me.handleAuthError(err)
  } finally {
    settling.value = false
  }
}

/** The stored settlement, once the reveal has been dismissed or on a reload. */
const settlement = computed(() => shift.value?.settlement ?? null)
const summary = computed(() => shift.value?.summary ?? null)

/** Positive: more in the apron than expected. Negative: short. */
function diffLabel(fen: number): string {
  if (fen === 0) return 'Tačno'
  return fen > 0 ? `Višak ${formatKm(fen)}` : `Manjak ${formatKm(Math.abs(fen))}`
}
</script>

<template>
  <ClientOnly>
    <div class="flex flex-1 flex-col">
      <WaiterHeader title="Završi smjenu" back-to="/konobar">
        <template #right>
          <WaiterSyncChip compact />
        </template>
      </WaiterHeader>

      <WaiterOutboxBanner />

      <main class="flex flex-1 flex-col gap-4 py-4">
        <p v-if="loading" class="py-10 text-center text-text-2">
          Učitavanje…
        </p>

        <p v-else-if="loadError" class="note note-danger text-center" role="alert">
          {{ loadError }}
        </p>

        <p v-else-if="!brief" class="empty">
          Nema otvorene smjene. Smjena se otvara prvom zaključanom turom.
        </p>

        <template v-else>
          <!-- The reveal: the only place an expected amount appears -->
          <div
            v-if="reveal"
            class="card flex flex-col gap-3 p-4"
            :class="reveal.within_tolerance ? 'border-good' : 'border-warn'"
          >
            <h2 class="section-title">
              Predano
            </h2>
            <div class="flex flex-col gap-1.5 text-body">
              <div class="flex justify-between gap-3">
                <span class="text-text-2">Ti si predao</span>
                <span class="num font-semibold">{{ formatKm(reveal.declared_fen) }}</span>
              </div>
              <div class="flex justify-between gap-3">
                <span class="text-text-2">Očekivano</span>
                <span class="num font-semibold">{{ formatKm(reveal.expected_fen) }}</span>
              </div>
              <div class="flex justify-between gap-3 border-t border-line-soft pt-2">
                <span class="text-text-2">Razlika</span>
                <span
                  class="num font-bold"
                  :class="reveal.within_tolerance ? 'text-good' : 'text-warn'"
                >{{ diffLabel(reveal.diff_fen) }}</span>
              </div>
            </div>

            <p class="text-label" :class="reveal.within_tolerance ? 'text-good' : 'text-warn'">
              <template v-if="reveal.within_tolerance">
                Unutar tolerancije ({{ formatKm(reveal.tolerance_fen) }}). Sve je u redu.
              </template>
              <template v-else>
                Van tolerancije ({{ formatKm(reveal.tolerance_fen) }}). Označeno za razgovor —
                nije optužba, nego stavka koju vlasnik pregleda.
              </template>
            </p>

            <!-- Where the expected number came from -->
            <div class="flex flex-col gap-1.5 border-t border-line-soft pt-3 text-label text-text-2">
              <div class="flex justify-between gap-3">
                <span>Gotovina koju si naplatio</span>
                <span class="num">{{ formatKm(reveal.breakdown.cash_fen) }}</span>
              </div>
              <div v-if="reveal.breakdown.float_out_fen" class="flex justify-between gap-3">
                <span>Sitno iz kase</span>
                <span class="num">{{ formatKm(reveal.breakdown.float_out_fen) }}</span>
              </div>
              <div v-if="reveal.breakdown.unpaid_fen" class="flex justify-between gap-3">
                <span>Nije plaćeno (čeka vlasnika)</span>
                <span class="num">{{ formatKm(reveal.breakdown.unpaid_fen) }}</span>
              </div>
              <div v-if="reveal.breakdown.void_held_fen" class="flex justify-between gap-3">
                <span>Storno koji čeka odobrenje</span>
                <span class="num">{{ formatKm(reveal.breakdown.void_held_fen) }}</span>
              </div>
            </div>

            <p v-if="reveal.self_sealed" class="text-label text-text-2">
              Predao si sam, bez kolege. Vlasnik potvrđuje kasnije.
            </p>

            <div v-if="reveal.stale_devices.length" class="note note-warn">
              Telefon koji se nije javio:
              {{ reveal.stale_devices.map(d => d.label).join(', ') }}.
            </div>

            <NuxtLink to="/konobar" class="btn btn-primary btn-lg">
              Gotovo
            </NuxtLink>
          </div>

          <!-- Already settled tonight (a reload after the reveal) -->
          <div v-else-if="settled && settlement" class="card flex flex-col gap-2 p-4">
            <h2 class="section-title">
              Pazar je predan
            </h2>
            <div class="flex justify-between gap-3 text-body">
              <span class="text-text-2">Predao</span>
              <span class="num font-semibold">{{ formatKm(settlement.declared_fen) }}</span>
            </div>
            <div class="flex justify-between gap-3 text-body">
              <span class="text-text-2">Razlika</span>
              <span class="num font-semibold">{{ diffLabel(settlement.diff_fen) }}</span>
            </div>
            <p v-if="settlement.accepted_by_name" class="text-label text-text-2">
              Primio: {{ settlement.accepted_by_name }}
            </p>
            <p v-else class="text-label text-text-2">
              Predao si sam; vlasnik potvrđuje kasnije.
            </p>

            <div v-if="summary" class="mt-1 flex flex-col gap-1.5 border-t border-line-soft pt-3 text-label text-text-2">
              <div class="flex justify-between gap-3">
                <span>Promet</span><span class="num">{{ formatKm(summary.promet_fen) }}</span>
              </div>
              <div class="flex justify-between gap-3">
                <span>Ture · stolovi · lule</span>
                <span class="num">{{ summary.rounds }} · {{ summary.tabs }} · {{ summary.bowls }}</span>
              </div>
              <div class="flex justify-between gap-3">
                <span>Sati</span><span class="num">{{ summary.hours.toFixed(1).replace('.', ',') }}</span>
              </div>
            </div>
          </div>

          <!-- The declaration -->
          <template v-else>
            <div class="card flex flex-col gap-2 p-4">
              <h2 class="section-title">
                Prije predaje
              </h2>
              <div
                v-for="item in checklist"
                :key="item.label"
                class="flex items-start gap-3 border-t border-line-soft pt-3 first:border-t-0 first:pt-0"
              >
                <span
                  class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-chip text-caption font-bold tracking-normal"
                  :class="item.ok ? 'bg-good-soft text-good' : 'bg-warn-soft text-warn'"
                >{{ item.ok ? '✓' : '!' }}</span>
                <div class="min-w-0">
                  <div class="font-semibold">
                    {{ item.label }}
                  </div>
                  <div class="text-label text-text-2">
                    {{ item.detail }}
                  </div>
                </div>
              </div>
              <NuxtLink v-if="myOpenTabs > 0" to="/konobar" class="btn btn-ghost mt-1">
                Nazad na stolove
              </NuxtLink>
            </div>

            <div class="card flex flex-col gap-3 p-4">
              <div>
                <h2 class="section-title">
                  Koliko imaš kod sebe?
                </h2>
                <p class="text-label text-text-2">
                  Prebroj pazar i upiši iznos. Očekivani iznos vidiš tek nakon predaje —
                  upisani i očekivani se zapisuju zajedno.
                </p>
              </div>

              <!-- The one number this screen asks for, in the system's numeric
                   field: 60 px, tabular, and large enough to check twice. -->
              <span class="input input-num flex items-center gap-2 px-4">
                <input
                  v-model="declaredRaw"
                  type="text"
                  inputmode="decimal"
                  placeholder="0,00"
                  class="num min-w-0 flex-1 bg-transparent text-right text-title font-semibold outline-none placeholder:text-muted"
                  aria-label="Predani iznos"
                >
                <span class="shrink-0 text-label font-normal text-text-2">KM</span>
              </span>

              <!-- The same sentence the server would send back, said first. -->
              <p v-if="blocked" class="note note-warn" role="status">
                {{ blockedText }} — smjena se ne može završiti dok ne odu.
              </p>

              <p v-if="settleError" class="note note-danger" role="alert">
                {{ settleError }}
              </p>
              <ul v-if="stuckDevices.length" class="note note-warn">
                <li v-for="device in stuckDevices" :key="device.label">
                  {{ device.label }}: {{ device.pending_count }} neposlanih
                </li>
              </ul>

              <button
                type="button"
                class="btn btn-primary btn-lg"
                :disabled="!canSettle"
                @click="settle"
              >
                {{ settling ? 'Predajem…' : 'Predaj pazar' }}
              </button>
            </div>
          </template>
        </template>
      </main>
    </div>

    <template #fallback>
      <p class="py-10 text-center text-text-2">
        Učitavanje…
      </p>
    </template>
  </ClientOnly>
</template>
