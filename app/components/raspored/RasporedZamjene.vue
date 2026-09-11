<script setup lang="ts">
/**
 * *Zamjene* — every swap request, by status. `/admin`, light kit.
 *
 * **This is the one screen besides *Dnevnik* where "bolest" is a word.** The
 * *Svi* line a taken swap posts is identical whether the reason was *zamjena* or
 * *bolest*, because a distinct wording would itself be the reason (PLAN §8, and
 * *Pravila*: "Bolovanje vidi samo vlasnik"). The reason reaches the owner here
 * and nowhere else in the app.
 *
 * Two actions, both one transaction on the server:
 *
 * - ***Dodijeli*** — the avatar picker names a taker and accepts in the same
 *   transaction. Three taps, and it stays open for up to seven days after the
 *   shift, marked "dodijeljeno naknadno" — a cover confirmed late is still a
 *   cover, and the *Sati* table should know who actually worked.
 * - ***Odbij*** — the owner closing a request nobody is going to take.
 */
import type { ApiSideError } from '~/composables/useApi'
import type { SwapRequestView, SwapStatus, UserAdmin } from '#shared/types'

const api = useAdminApi()

const STATUSES: { value: SwapStatus | 'sve', label: string }[] = [
  { value: 'pending', label: 'Čeka' },
  { value: 'accepted', label: 'Preuzete' },
  { value: 'sve', label: 'Sve' },
]

const status = ref<string>('pending')
const rows = ref<SwapRequestView[]>([])
const people = ref<UserAdmin[]>([])
const loading = ref(true)
const error = ref('')
const busy = ref(false)

async function load() {
  try {
    rows.value = await api.listSwaps(status.value === 'sve' ? undefined : status.value)
    error.value = ''
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await load()
  try {
    people.value = (await api.getUsers()).filter(u => u.active)
  } catch { /* the picker says so; the list still draws. */ }
})

watch(status, () => { loading.value = true; void load() })

const changes = useAdminChanges({
  onEntity: (entity) => { if (entity === 'roster') void load() },
})

// -- Dodijeli ---------------------------------------------------------------

const assigning = ref<SwapRequestView | null>(null)
const pickError = ref<string | null>(null)
const pendingId = ref<string | null>(null)
const doubleAsk = ref<{ userId: string, name: string } | null>(null)

/** Everybody but the person handing the shift over — you cannot cover yourself. */
const pickPeople = computed(() =>
  people.value.filter(p => p.id !== assigning.value?.from_user_id))

async function assign(userId: string, forceDouble = false) {
  if (!assigning.value) return
  pendingId.value = userId
  pickError.value = null
  try {
    await api.assignSwap(assigning.value.id, userId, forceDouble)
    assigning.value = null
    doubleAsk.value = null
    await load()
    await changes.refresh()
  } catch (err) {
    const code = (err as ApiSideError)?.code
    if (code === 'DOUBLE_SHIFT' && !forceDouble) {
      doubleAsk.value = { userId, name: people.value.find(p => p.id === userId)?.name ?? '' }
    } else {
      pickError.value = apiErrorText(err)
    }
  } finally {
    pendingId.value = null
  }
}

function openAssign(row: SwapRequestView) {
  assigning.value = row
  pickError.value = null
  doubleAsk.value = null
}

function closeAssign() {
  assigning.value = null
  doubleAsk.value = null
}

async function decline(row: SwapRequestView) {
  busy.value = true
  error.value = ''
  try {
    await api.declineSwap(row.id)
    await load()
    await changes.refresh()
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    busy.value = false
  }
}

const columns = [
  { key: 'when', label: 'Smjena' },
  { key: 'who', label: 'Traži' },
  { key: 'to', label: 'Kome' },
  { key: 'reason', label: 'Razlog' },
  { key: 'status', label: 'Status' },
  { key: 'act', label: '', align: 'r' as const },
]

const tone = (s: SwapStatus) =>
  (s === 'accepted' ? 'good' : s === 'pending' ? 'warn' : 'neutral')
</script>

<template>
  <div class="r-tab">
    <UiCard title="Zamjene" :count="rows.length">
      <template #actions>
        <UiSeg v-model="status" :options="STATUSES" label="Status zamjene" />
      </template>

      <p v-if="error" class="r-error" role="alert">{{ error }}</p>

      <p v-if="!loading && !rows.length" class="r-quiet">
        Nema nijedne zamjene u ovom filteru.
      </p>

      <!-- `data-l` is what lets the phone drop the header row and still say
           which fact is which; see the style block. -->
      <UiTable v-else :columns="columns" :loading="loading">
        <tr v-for="row in rows" :key="row.id">
          <td class="r-when">
            <strong>{{ dayLabelBs(row.work_date) }}</strong><br>
            <small class="r-quiet">
              {{ row.template_name }} {{ timeSpanBs(row.start_time, row.end_time) }}
            </small>
          </td>
          <td data-l="Traži">{{ row.from_user_name }}</td>
          <td data-l="Kome">{{ row.to_user_name ?? 'svima' }}</td>
          <td data-l="Razlog">
            <span>
              {{ row.reason ?? '—' }}
              <br v-if="row.note">
              <small v-if="row.note" class="r-quiet">{{ row.note }}</small>
            </span>
          </td>
          <td class="r-state">
            <UiPill :tone="tone(row.status)">{{ SWAP_STATUS_BS[row.status] }}</UiPill>
            <br v-if="row.decided_by_name">
            <small v-if="row.decided_by_name" class="r-quiet">
              {{ row.decided_by_name }} · {{ dateBs(row.decided_at) }}
            </small>
          </td>
          <td class="r-act">
            <template v-if="row.status === 'pending'">
              <UiButton small variant="primary" @click="openAssign(row)">
                Dodijeli
              </UiButton>
              <UiButton small variant="ghost" :pending="busy" @click="decline(row)">
                Odbij
              </UiButton>
            </template>
          </td>
        </tr>
      </UiTable>

      <p class="r-quiet">
        Razlog zamjene stoji samo ovdje i u Dnevniku. Poruka koju kolege vide je
        ista za oba razloga.
      </p>
    </UiCard>

    <RasporedPicker
      :open="!!assigning && !doubleAsk"
      :title="assigning ? `Dodijeli · ${dayLabelBs(assigning.work_date)} ${assigning.template_name}` : 'Dodijeli'"
      :people="pickPeople"
      :busy="new Map()"
      :taken="new Set()"
      :pending-id="pendingId"
      :error="pickError"
      @close="closeAssign"
      @pick="id => assign(id)"
    />

    <UiSheet
      :open="!!doubleAsk"
      title="Dupla smjena"
      action="Svejedno dodijeli"
      :pending="!!pendingId"
      @close="doubleAsk = null"
      @confirm="assign(doubleAsk!.userId, true)"
    >
      <p>
        {{ doubleAsk?.name }} već radi jednu smjenu tog dana. Smjene se ne
        preklapaju, ali je to dupla smjena.
      </p>
    </UiSheet>
  </div>
</template>

<style scoped>
.r-tab { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.r-quiet { margin: 0; color: var(--muted); font-size: var(--text-micro); }
.r-error { margin: 0; color: var(--danger); font-weight: 500; }
.r-act { white-space: nowrap; }
.r-act :deep(.a-btn) + :deep(.a-btn) { margin-left: 6px; }

/**
 * The phone: a request is a card, not six columns.
 *
 * Six columns on a 358 px screen is a table that scrolls sideways under a
 * thumb, and the column that goes over the edge is the one with the two
 * buttons on it — so the owner could see a swap and not reach the decision.
 * Below the breakpoint each `<tr>` becomes a two-column grid instead: the
 * shift and its state on the first line, the three facts under it beside
 * their own labels, and *Dodijeli* / *Odbij* across the foot.
 *
 * It is laid out, never duplicated. One `<tr>` in the DOM means one
 * *Dodijeli* button on the page at any width, which is what keeps a locator
 * (and a screen reader) honest.
 */
@media (max-width: 1023px) {
  .r-act :deep(.a-btn) { height: 44px; }

  .r-tab :deep(.a-table thead) { display: none; }
  .r-tab :deep(.a-table),
  .r-tab :deep(.a-table tbody),
  .r-tab :deep(.a-table td) { display: block; }

  .r-tab :deep(.a-table tr) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    column-gap: 10px;
    padding: 12px 0 14px;
    border-bottom: 1px solid var(--line-soft);
  }

  .r-tab :deep(.a-table tbody tr:last-child) { border-bottom: 0; }

  .r-tab :deep(.a-table td) { border-bottom: 0; padding: 3px 0; }

  /* `td.<class>` inside `:deep()`: one point more than the `td` rule above, so
     the layout does not hang on which of the two the bundler emits first. */
  .r-tab :deep(.a-table td.r-when) { grid-column: 1; grid-row: 1; }
  .r-tab :deep(.a-table td.r-state) { grid-column: 2; grid-row: 1; text-align: right; }

  .r-tab :deep(.a-table td[data-l]) {
    grid-column: 1 / -1;
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }

  .r-tab :deep(.a-table td[data-l])::before {
    content: attr(data-l);
    flex: 0 0 62px;
    font-size: var(--text-caption);
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--muted);
    font-weight: 600;
  }

  .r-tab :deep(.a-table td.r-act) {
    grid-column: 1 / -1;
    display: flex;
    gap: 8px;
    white-space: normal;
  }

  .r-act :deep(.a-btn) { flex: 1; }
  .r-act :deep(.a-btn) + :deep(.a-btn) { margin-left: 0; }
}
</style>
