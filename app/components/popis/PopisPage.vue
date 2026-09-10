<script setup lang="ts">
/**
 * *Brzi popis* (F9) — the whole screen, rendered by both `/konobar/popis` and
 * `/sanker/popis` so a waiter and a šanker each reach it from their own nav without
 * two copies of it existing.
 *
 * Four things this screen is careful about:
 *
 * **Nothing expected is on screen before *Predaj*.** Not the on-hand, not a
 * suggestion, not a placeholder. `StockItem.on_hand` is deliberately never
 * rendered here even though it is in the same array the rows come from.
 *
 * **One body, one request.** The whole count goes in one `POST`, because a
 * count is a reading of one instant; per-line saving would produce a count
 * whose lines were true at nineteen different times (BACKEND §14.5).
 *
 * **The refusals are readable.** `PENDING_OUTBOX` names the phone,
 * `NOTE_REQUIRED` opens the note on the first line that needs one and scrolls
 * to it, `COUNT_EXISTS` says this shift already has such a count.
 *
 * **The draft lives in memory, on purpose.** `useState` keeps it while the app
 * stays open — walking to *Stanje šanka* and back loses nothing — but the phone
 * writes no storage of its own: IndexedDB in `/konobar` belongs to the outbox
 * and the cart (PHASE3 §2), and a count that survived a reload but not the
 * shift's clock would be a reading of an instant that has passed. Under five
 * minutes, in one go, is how F9 is meant to be walked.
 */
import type { CountView, StaleDevice, StockItem, SubmitCountBody, User } from '#shared/types'
import { ApiSideError } from '~/composables/useApi'

const props = defineProps<{
  /** Where the back arrow goes: `/konobar` for a waiter, `/sanker` for a šanker. */
  backTo: string
}>()

const me = useMe()
const counts = useCounts()
const { data: boot } = useBootstrapData()
// The bartender queues stock from here too (an otpis mid-count), so this screen
// runs the same flush timers every other `/konobar` and `/sanker` screen runs.
useOutbox()
const { pending, blockedText } = useSync()

type Phase = 'open' | 'close' | 'adhoc'

/**
 * One word each. At 390 px *Početak smjene* and *Kraj smjene* wrapped to two
 * lines while *Usput* stayed on one, so three labels sat on three baselines
 * beside a two-line thumb — and it is the first thing on the screen. The page
 * title already says *Brzi popis* and the note under the control says which
 * count is missing, so "smjene" was carrying nothing.
 */
const PHASES: { key: Phase, label: string }[] = [
  { key: 'open', label: 'Početak' },
  { key: 'close', label: 'Kraj' },
  { key: 'adhoc', label: 'Usput' },
]

/** One row of the draft: what was typed, in which unit, plus its note. */
interface DraftRow {
  value: string
  unit: 'pack' | 'base'
  note: string
}

const items = ref<StockItem[]>([])
/**
 * `undefined` until the first poll answers, `null` when there is no open shift.
 * The difference matters: "nobody has told us yet" and "there is no shift
 * tonight" lead to two different default phases, and one `null` would hide the
 * first answer behind the initial value.
 */
const shiftId = ref<string | null | undefined>(undefined)
const phase = useState<Phase>('sank:popis:phase', () => 'close')
const draft = useState<Record<string, DraftRow>>('sank:popis:draft', () => ({}))
/** Set by the server's 422: these rows go back needing a note. */
const needNote = ref<string[]>([])

const submitting = ref(false)
const submitError = ref<string | null>(null)
const stuckDevices = ref<StaleDevice[]>([])
const result = ref<CountView | null>(null)

const witnessing = ref(false)
const witnessError = ref<string | null>(null)

/** Has this shift already had its opening count? Decides the default phase. */
const hasOpenCount = ref<boolean | null>(null)

const { refresh } = useChanges({
  stock: (list) => { items.value = list },
  tables: (state) => {
    const id = state.shift?.id ?? null
    if (id !== shiftId.value) {
      shiftId.value = id
      void loadShiftCounts()
    }
  },
  me: () => me.load(),
}, { intervalMs: 15_000 })

onMounted(async () => {
  await me.requireSession()
})

/**
 * Which counts this shift already has. It answers one question the screen
 * cannot guess: whether tonight still needs its opening count — and F1 step 3
 * is emphatic that a shift without one cannot be closed.
 */
async function loadShiftCounts() {
  if (!shiftId.value) {
    // No shift at all is not an empty screen: F1 step 3 says the opening count
    // is one of the two things that *start* a night, and `submitCount` opens
    // the shift itself when the phase is `open`. So that is where the segmented
    // control sits before the first round is locked.
    hasOpenCount.value = null
    phase.value = 'open'
    return
  }
  try {
    const rows = await counts.listCounts({ shift_id: shiftId.value })
    hasOpenCount.value = rows.some(c => c.phase === 'open')
    if (!hasOpenCount.value) phase.value = 'open'
    else if (phase.value === 'open') phase.value = 'close'
  } catch {
    // A read that failed is not an answer: leave the segmented control where
    // the person put it rather than guessing at the shift's history.
    hasOpenCount.value = null
  }
}

/**
 * A 401 ends the screen; nothing else does.
 *
 * `me.handleAuthError` classifies whatever it is handed the way it classifies an
 * answer from `/api/me`, where anything unexpected means "nobody is logged in".
 * That is right for a poll and wrong for a screen that gets told *"this line
 * needs a note"* — handing it a 422 would send the person back to the lock
 * screen with his count in his hand. So only a real session failure goes there.
 */
function onAuthError(err: unknown): void {
  if ((err as ApiSideError).status === 401) void me.handleAuthError(err)
}

const spot = computed(() => items.value.filter(i => i.is_spot))

/**
 * A row starts empty and counted in base units — pieces, grams — because that
 * is what a person holding the shelf sees first. The toggle is there for the
 * gajba of Coca-Cola nobody wants to count bottle by bottle.
 */
const EMPTY_ROW: DraftRow = { value: '', unit: 'base', note: '' }

function rowOf(item: StockItem): DraftRow {
  return draft.value[item.id] ?? EMPTY_ROW
}

function setRow(itemId: string, patch: Partial<DraftRow>) {
  const current = draft.value[itemId] ?? EMPTY_ROW
  draft.value = { ...draft.value, [itemId]: { ...current, ...patch } }
  if (patch.note) needNote.value = needNote.value.filter(id => id !== itemId)
}

const counted = computed(() =>
  spot.value.filter(item => parseDecimalInput(rowOf(item).value) !== null).length)
const remaining = computed(() => spot.value.length - counted.value)
const canSubmit = computed(() => spot.value.length > 0 && remaining.value === 0 && !submitting.value)

const isApprover = computed(() =>
  me.user.value?.role === 'admin' || me.user.value?.role === 'bartender')

const waiters = computed<User[]>(() =>
  (boot.value?.users ?? []).filter(u => u.role === 'waiter'))

/**
 * *Dopuni smjenu* belongs to whoever holds the drawer — the šanker, or the
 * owner. It appears the moment a shift exists rather than only on the opening
 * count: a night usually opens itself with the first locked round (F1 step 1),
 * and the change still has to be handed out after that.
 */
const showFloat = computed(() => isApprover.value && !!shiftId.value)

const floatGiven = ref<Record<string, number>>({})
const floatBusy = ref(false)
const floatError = ref<string | null>(null)

async function giveFloat(payload: { userId: string, amountFen: number }) {
  if (!shiftId.value || floatBusy.value) return
  floatBusy.value = true
  floatError.value = null
  try {
    await counts.moveFloat(shiftId.value, {
      type: 'float_out',
      user_id: payload.userId,
      amount_fen: payload.amountFen,
    })
    floatGiven.value = { ...floatGiven.value, [payload.userId]: payload.amountFen }
  } catch (err) {
    floatError.value = apiErrorText(err, 'Sitno nije proknjiženo.')
    onAuthError(err)
  } finally {
    floatBusy.value = false
  }
}

/** The count, as the server wants it: one line per spot item, in base units. */
function buildBody(): SubmitCountBody {
  const lines = spot.value.map((item) => {
    const row = rowOf(item)
    const typed = parseDecimalInput(row.value) ?? 0
    const note = row.note.trim() ? row.note.trim() : undefined

    if (item.count_method === 'weigh') {
      // Gross grams. The tare comes off on the server — the phone never
      // computes a quantity that will be stored.
      return { stock_item_id: item.id, weighed_g: typed, note }
    }
    return row.unit === 'pack'
      ? { stock_item_id: item.id, packs: typed, loose: 0, note }
      : { stock_item_id: item.id, packs: 0, loose: typed, note }
  })

  return { kind: 'spot', phase: phase.value, lines }
}

async function submit() {
  if (!canSubmit.value) return

  submitting.value = true
  submitError.value = null
  stuckDevices.value = []
  needNote.value = []

  try {
    result.value = await counts.submitCount(buildBody())
    draft.value = {}
    await refresh()
  } catch (err) {
    const e = err as ApiSideError
    if (e.code === 'PENDING_OUTBOX') {
      stuckDevices.value = (e.data?.devices as StaleDevice[]) ?? []
    } else if (e.code === 'NOTE_REQUIRED' || e.code === 'LINES_MISSING') {
      needNote.value = (e.data?.item_ids as string[]) ?? []
      submitError.value = apiErrorText(err)
      await nextTick()
      const first = needNote.value[0]
      if (first) {
        document.getElementById(`popis-${first}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    } else {
      submitError.value = apiErrorText(err, 'Popis nije predan.')
    }
    onAuthError(err)
  } finally {
    submitting.value = false
  }
}

async function witness() {
  const count = result.value
  if (!count || witnessing.value) return
  witnessing.value = true
  witnessError.value = null
  try {
    result.value = await counts.witnessCount(count.id)
  } catch (err) {
    witnessError.value = apiErrorText(err, 'Potvrda nije upisana.')
    onAuthError(err)
  } finally {
    witnessing.value = false
  }
}

function startOver() {
  result.value = null
  void navigateTo(props.backTo)
}

/** Phones of this shift that are switched off, reported on the count itself. */
const staleOnCount = computed(() => result.value?.stale_devices ?? [])
</script>

<template>
  <div class="flex flex-1 flex-col">
    <WaiterHeader title="Brzi popis" :back-to="backTo">
      <template #right>
        <WaiterSyncChip />
      </template>
    </WaiterHeader>

    <WaiterOutboxBanner />

    <main class="flex flex-1 flex-col gap-4 py-4">
      <!-- After the submit the screen is the result and nothing else. -->
      <PopisResult
        v-if="result"
        :count="result"
        :me-id="me.user.value?.id ?? null"
        :busy="witnessing"
        :error="witnessError"
        @witness="witness"
        @done="startOver"
      />

      <template v-else>
        <!-- Which count this is. A segmented control, not three copper
             buttons: choosing a phase is not a primary action. -->
        <UiSeg
          block
          label="Vrsta popisa"
          :options="PHASES.map(p => ({ value: p.key, label: p.label }))"
          :model-value="phase"
          @update:model-value="phase = $event as Phase"
        />

        <p v-if="phase === 'open' && hasOpenCount === false" class="note note-warn">
          Ova smjena još nema početni popis. Smjena bez njega ne može se
          zatvoriti bez vlasnika.
        </p>

        <PopisPendingCard
          v-if="stuckDevices.length > 0"
          :devices="stuckDevices"
          :busy="submitting"
          @retry="submit"
        />

        <p v-if="pending > 0" class="note note-warn">
          {{ blockedText }} s ovog telefona. Pošalji ih prije popisa — inače će
          se prikazati kao manjak.
        </p>

        <section class="flex flex-col gap-3">
          <div class="flex items-baseline justify-between gap-2">
            <h2 class="section-title">
              Stavke za popis
            </h2>
            <span class="num text-label text-text-2">{{ counted }} / {{ spot.length }}</span>
          </div>

          <PopisItemRow
            v-for="item in spot"
            :key="item.id"
            :item="item"
            :value="rowOf(item).value"
            :unit="rowOf(item).unit"
            :note="rowOf(item).note"
            :needs-note="needNote.includes(item.id)"
            @update:value="setRow(item.id, { value: $event })"
            @update:unit="setRow(item.id, { unit: $event })"
            @update:note="setRow(item.id, { note: $event })"
          />

          <p v-if="spot.length === 0" class="card px-4 py-8 text-center text-text-2">
            Nema stavki za brzi popis. Vlasnik bira šta se popisuje svaku smjenu.
          </p>
        </section>

        <!-- *Dopuni smjenu* sits under the count, not above it. It is an
             occasional errand for whoever holds the drawer, and it used to be
             the first card on a screen named after counting — pushing *Stavke
             za popis*, the thing the screen is for, below the fold. -->
        <PopisFloatCard
          v-if="showFloat"
          :waiters="waiters"
          :busy="floatBusy"
          :error="floatError"
          :given="floatGiven"
          @float="giveFloat"
        />

        <p v-if="submitError" class="note note-danger" role="alert">
          {{ submitError }}
        </p>

        <p class="pb-24 text-center text-caption tracking-normal text-muted">
          Popis se predaje odjednom, s vezom. Ono što se očekuje na polici vidiš
          tek nakon predaje.
        </p>
      </template>
    </main>

    <!-- The primary action, pinned where a thumb is. -->
    <div
      v-if="!result"
      class="sticky bottom-0 -mx-4 border-t border-line bg-bg px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
    >
      <button
        type="button"
        class="btn btn-primary btn-lg w-full"
        :disabled="!canSubmit"
        @click="submit"
      >
        {{ submitting ? 'Šaljem…' : 'Predaj popis' }}
      </button>
      <p v-if="remaining > 0" class="num pt-2 text-center text-label text-text-2">
        Ostalo još {{ remaining }} — upiši i nulu ako police nema ništa.
      </p>
    </div>

    <div v-if="staleOnCount.length > 0" class="pb-4 text-label text-text-2">
      Ugašeni telefoni u ovoj smjeni:
      {{ staleOnCount.map(d => d.label).join(', ') }} — ako se jave kasno, ture
      ulaze u ovaj popis.
    </div>
  </div>
</template>
