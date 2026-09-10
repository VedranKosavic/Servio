<script setup lang="ts">
/**
 * *Puls* — what is happening in the café right now.
 *
 * **One read.** Everything on this page comes out of `GET /api/owner/live`:
 * the six tiles, the two lists, the feed and the floor plan. Nothing here opens
 * a second endpoint for a number that is already in that object, and nothing
 * here keeps a `setInterval` — the dashboard has exactly one timer,
 * `useAdminChanges()`, and this page refetches on its tick.
 *
 * **Why it refetches on every tick and not only when something is written.**
 * Half of this screen moves with the clock rather than with the ledger: a table
 * gets older, a phone goes stale, an attention row climbs the list. So the
 * server puts the minute into this route's ETag on purpose and the page asks
 * again every 15 s. An **ETag** is a fingerprint of an answer — the browser
 * sends it back, and a server whose answer has not changed replies "304 Not
 * Modified" with no body at all.
 *
 * The one thing not in that read is the **catalogue**: `TableState` carries who
 * is sitting at a table and for how much, but a table's *name* and *zone* belong
 * to `GET /api/bootstrap`, which every screen in the app already holds and which
 * changes about twice a year. `groupTablesByZone()` joins the two by id.
 */
import type { AttentionAction, AttentionItem, OwnerLive, TabDetail } from '#shared/types'
import type { PulsTableTile } from '~/utils/puls'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Puls' })

const api = useAdminApi()

const live = ref<OwnerLive | null>(null)
const loadError = ref('')
/** When the last read actually landed — the "Ažurirano 22:41" in the header. */
const updatedAt = ref<string | null>(null)

/** The floor plan's names and zones. Cached by `useAsyncData`, so one download. */
const { data: bootstrap } = useBootstrapData()

/**
 * A clock for *rendering*, not for fetching.
 *
 * Table ages are drawn from `opened_at` against "now", so without something
 * ticking, "48 min" would sit there saying 48 min until the next poll. VueUse's
 * `useNow` re-renders them every half minute; the data still arrives only on the
 * one poll.
 */
const now = useNow({ interval: 30_000 })

// One timer for the whole dashboard; this page only subscribes to its tick.
// `load` is a function declaration, so it is hoisted above this line.
const changes = useAdminChanges({ raw: () => { void load() } })

/** One read at a time: the mount and the first tick must not both fetch. */
let inFlight = false

async function load() {
  if (inFlight) return
  inFlight = true
  try {
    live.value = await api.getLive()
    updatedAt.value = new Date().toISOString()
    loadError.value = ''
    changes.setAttentionCount(live.value.attention.length)
  } catch (err) {
    // The old numbers stay on screen and the header says they are old — a
    // dashboard that silently shows yesterday's promet is worse than one that
    // admits it could not reach the server.
    loadError.value = apiErrorText(err)
  } finally {
    inFlight = false
  }
}

const zones = computed(() => live.value && bootstrap.value
  ? groupTablesByZone(live.value.tables, bootstrap.value.tables, now.value.getTime())
  : [])

const headerLine = computed(() => {
  const shift = live.value?.shift
  const parts: string[] = []
  if (shift) parts.push(`${weekdayBs(shift.business_date)} ${dateBs(shift.business_date)}`)
  parts.push(shiftLineBs(shift?.status ?? null, shift?.closer_name ?? null))
  if (updatedAt.value) parts.push(`Ažurirano ${timeBs(updatedAt.value)}`)
  return parts.filter(Boolean).join(' · ')
})

// ---------------------------------------------------------------------------
// The one-tap decisions
// ---------------------------------------------------------------------------

/** `"<ref_id>|<action>"` of the decision in flight, so only that button spins. */
const busy = ref<string | null>(null)
const decideError = ref('')

/** The force-close sheet: the one action that will not go without a sentence. */
const noteFor = ref<{ item: AttentionItem, action: AttentionAction, target: string } | null>(null)
const noteText = ref('')
const noteError = ref('')

function onAct(item: AttentionItem, action: AttentionAction, target: string) {
  decideError.value = ''
  if (decisionNeedsNote(item.ref_type, action)) {
    noteFor.value = { item, action, target }
    noteText.value = ''
    noteError.value = ''
    return
  }
  void post(item, action, target)
}

async function post(
  item: AttentionItem, action: AttentionAction, target: string, note?: string,
) {
  if (busy.value) return
  busy.value = `${item.ref_id}|${action}`
  try {
    await api.postAttention(target, decisionBody(item.ref_type, action, note))
    // The row is gone from the server's list the moment the decision commits,
    // so the honest way to take it off the screen is to re-read — not to splice
    // it out of an array and hope the two agree.
    await load()
    noteFor.value = null
  } catch (err) {
    decideError.value = apiErrorText(err)
    noteError.value = decideError.value
  } finally {
    busy.value = null
  }
}

function confirmNote() {
  const pendingAct = noteFor.value
  if (!pendingAct) return
  if (noteText.value.trim().length < NOTE_MIN) {
    noteError.value = `Napiši razlog — najmanje ${NOTE_MIN} znaka.`
    return
  }
  void post(pendingAct.item, pendingAct.action, pendingAct.target, noteText.value)
}

// ---------------------------------------------------------------------------
// A table's rounds
// ---------------------------------------------------------------------------

const tab = ref<TabDetail | null>(null)
const tabTitle = ref('')
const tabPending = ref(false)
const tabError = ref('')
const tabOpen = ref(false)

async function openTable(tile: PulsTableTile) {
  if (!tile.tab_id) return
  tabOpen.value = true
  tabTitle.value = tile.name
  tab.value = null
  tabError.value = ''
  tabPending.value = true
  try {
    tab.value = await api.getTab(tile.tab_id)
  } catch (err) {
    tabError.value = apiErrorText(err)
  } finally {
    tabPending.value = false
  }
}

onMounted(() => { void load() })
</script>

<template>
  <div class="a-page">
    <UiPageHead
      eyebrow="Lokal"
      title="Puls"
      :sub="headerLine || 'Šta se upravo dešava u lokalu'"
      :stale="loadError ? `Nije osvježeno — ${loadError}` : undefined"
    />

    <template v-if="live">
      <PulsTiles :live="live" />

      <div class="a-cols">
        <div class="a-col">
          <PulsAttention
            :items="live.attention"
            :flags="live.flags"
            :shift-id="live.shift?.id"
            :busy="busy"
            :error="decideError"
            @act="onAct"
          />
          <PulsFeed :rows="live.last_lines" />
        </div>

        <PulsTableGrid :groups="zones" @open="openTable" />
      </div>
    </template>

    <!-- The first paint: a skeleton, never a spinner over numbers that are not
         there yet. -->
    <UiCard v-else-if="!loadError">
      <p class="a-muted">Učitavanje…</p>
    </UiCard>

    <!-- The force-close note. `POST /api/shifts/:id/force-close` refuses an
         empty one, and a decision this heavy should carry a sentence anyway. -->
    <UiSheet
      :open="!!noteFor"
      title="Zatvori smjenu bez predaje"
      action="Zatvori smjenu"
      :pending="!!busy"
      @close="noteFor = null"
      @confirm="confirmNote"
    >
      <p class="a-muted">{{ noteFor?.item.title_bs }}</p>
      <UiField
        v-model="noteText"
        label="Razlog"
        kind="textarea"
        :error="noteError"
        placeholder="Otišao kući prije predaje…"
      />
    </UiSheet>

    <!-- One table's rounds. Read-only: the owner looks, the waiter charges. -->
    <UiSheet :open="tabOpen" :title="tabTitle" @close="tabOpen = false">
      <p v-if="tabPending" class="a-muted">Učitavanje…</p>
      <p v-else-if="tabError" class="a-error">{{ tabError }}</p>

      <template v-else-if="tab">
        <div class="a-tab-sum">
          <span>{{ tab.tab.assigned_to_name ?? '' }}</span>
          <span class="a-muted">otvoren {{ timeBs(tab.tab.opened_at) }}</span>
          <UiMoney class="a-tab-total" :fen="tab.money.remaining_fen" />
        </div>

        <div v-for="order in tab.orders" :key="order.id" class="a-tab-order">
          <div class="a-tab-order-head">
            <b>{{ order.shift_seq ? `${order.shift_seq}. tura` : 'tura' }}</b>
            <span class="a-muted">{{ timeBs(order.at) }} · {{ order.locked_by_name }}</span>
          </div>
          <div v-for="line in order.lines" :key="line.id" class="a-tab-line">
            <span>
              {{ line.qty > 1 ? `${line.qty}× ` : '' }}{{ line.name_snapshot }}
              <em v-if="line.flavour_names.length">({{ line.flavour_names.join(' + ') }})</em>
              <em v-if="line.status !== 'ok'" class="a-tab-mark">· {{ line.status === 'gratis' ? 'gratis' : 'storno' }}</em>
            </span>
            <UiMoney :fen="line.charged_fen" :currency="false" :colour="false" />
          </div>
        </div>

        <div v-for="payment in tab.payments" :key="payment.id" class="a-tab-line">
          <span>{{ payment.method === 'cash' ? 'Gotovina' : 'Kartica' }} · {{ timeBs(payment.at) }}</span>
          <UiMoney :fen="payment.amount_fen" :currency="false" :colour="false" />
        </div>
      </template>

      <template #footer>
        <UiButton variant="ghost" @click="tabOpen = false">Zatvori</UiButton>
      </template>
    </UiSheet>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

.a-muted { margin: 0; color: var(--ink-2); font-size: var(--text-label); }
.a-error { margin: 0; color: var(--danger); font-size: var(--text-label); }

/* The mockup's 7 / 5 split: the lists on the left, the floor plan on the right. */
.a-cols {
  display: grid;
  grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
  gap: 16px;
  align-items: start;
}

.a-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

/* -- the tab sheet ------------------------------------------------------- */

.a-tab-sum {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
  font-size: var(--text-label);
}

.a-tab-total {
  margin-left: auto;
  font-family: var(--font-display);
  font-size: var(--text-section);
  font-weight: 700;
}

.a-tab-order { display: flex; flex-direction: column; gap: 4px; }

.a-tab-order-head {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: var(--text-micro);
}

.a-tab-order-head b { font-size: var(--text-label); }

.a-tab-line {
  display: flex;
  gap: 10px;
  align-items: baseline;
  font-size: var(--text-label);
  font-variant-numeric: tabular-nums;
}

.a-tab-line > span:first-child { flex-grow: 1; min-width: 0; }
.a-tab-line em { font-style: normal; color: var(--muted); }
.a-tab-mark { color: var(--danger); }

@media (max-width: 1023px) {
  .a-cols { grid-template-columns: minmax(0, 1fr); gap: 16px; }
}
</style>
