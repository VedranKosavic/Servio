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

      <UiTable v-else :columns="columns" :loading="loading">
        <tr v-for="row in rows" :key="row.id">
          <td>
            <strong>{{ dayLabelBs(row.work_date) }}</strong><br>
            <small class="r-quiet">
              {{ row.template_name }} {{ timeSpanBs(row.start_time, row.end_time) }}
            </small>
          </td>
          <td>{{ row.from_user_name }}</td>
          <td>{{ row.to_user_name ?? 'svima' }}</td>
          <td>
            {{ row.reason ?? '—' }}
            <br v-if="row.note">
            <small v-if="row.note" class="r-quiet">{{ row.note }}</small>
          </td>
          <td>
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

@media (max-width: 1023px) {
  .r-act :deep(.a-btn) { height: 44px; }
}
</style>
