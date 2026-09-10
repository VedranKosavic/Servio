<script setup lang="ts">
/**
 * *Popisi* — every count, and the form that makes a new one.
 *
 * A count is submitted by whoever counted and **confirmed by the owner**: only
 * the confirm writes `count_adjust` rows into the ledger. Until then the
 * variance is a claim on a screen and the shelf's number has not moved.
 */
import type { CountView, StockItemAdmin } from '#shared/types'
import type { UiColumn } from '~/components/ui/UiTable.vue'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Roba — popisi' })

const api = useAdminApi()

const counts = ref<CountView[]>([])
const items = ref<StockItemAdmin[]>([])
const loading = ref(true)
const error = ref('')
const filter = ref<'sve' | 'submitted' | 'confirmed'>('sve')
const formOpen = ref(false)

async function load() {
  loading.value = true
  try {
    counts.value = await api.getCounts(
      filter.value === 'sve' ? {} : { status: filter.value },
    )
    error.value = ''
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

async function loadCatalogue() {
  try {
    items.value = await api.getStockItems()
  } catch (err) {
    error.value = apiErrorText(err)
  }
}

useAdminChanges({
  onEntity: (entity) => { if (entity === 'count' || entity === 'stock') void load() },
})

onMounted(() => {
  void load()
  void loadCatalogue()
})

watch(filter, () => { void load() })

const COLUMNS: UiColumn[] = [
  { key: 'when', label: 'Kada' },
  { key: 'kind', label: 'Vrsta' },
  { key: 'who', label: 'Popisao' },
  { key: 'lines', label: 'Stavki', align: 'r' },
  { key: 'oot', label: 'Van tolerancije', align: 'r' },
  { key: 'variance', label: 'Manjak / višak', align: 'r' },
  { key: 'status', label: 'Status' },
  { key: 'go', label: '' },
]

const KIND_LABELS: Record<CountView['kind'], string> = { spot: 'spot', full: 'puni' }
const PHASE_LABELS: Record<CountView['phase'], string> = {
  open: 'otvaranje', close: 'zatvaranje', adhoc: 'vanredni',
}

const FILTERS = [
  { value: 'sve', label: 'Svi' },
  { value: 'submitted', label: 'Čekaju' },
  { value: 'confirmed', label: 'Potvrđeni' },
]

const waiting = computed(() => counts.value.filter(c => c.status === 'submitted').length)

function onSubmitted(saved: CountView) {
  formOpen.value = false
  void load()
  void navigateTo(`/admin/roba/popisi/${saved.id}`)
}
</script>

<template>
  <div class="a-page">
    <RobaTabs sub="popisi · manjak i višak po stavci">
      <template #actions>
        <UiButton :variant="formOpen ? 'ghost' : 'primary'" @click="formOpen = !formOpen">
          {{ formOpen ? 'Zatvori formu' : 'Novi popis' }}
        </UiButton>
      </template>
    </RobaTabs>

    <p v-if="error" class="a-error">{{ error }}</p>

    <RobaPopisForm v-if="formOpen" :items="items" @submitted="onSubmitted" />

    <UiCard title="Popisi" :count="waiting > 0 ? `${waiting} čeka potvrdu` : `${counts.length}`">
      <template #actions>
        <UiSeg v-model="filter" :options="FILTERS" label="Status popisa" />
      </template>

      <UiTable :columns="COLUMNS" :loading="loading">
        <tr v-for="count in counts" :key="count.id">
          <td class="a-nowrap">{{ dateTimeBs(count.submitted_at) }}</td>
          <td class="a-nowrap">{{ KIND_LABELS[count.kind] }} · {{ PHASE_LABELS[count.phase] }}</td>
          <td>{{ count.counted_by_name }}</td>
          <td class="r">{{ count.totals.lines }}</td>
          <td class="r">{{ count.totals.out_of_tolerance }}</td>
          <td class="r"><UiMoney :fen="count.totals.variance_fen" :currency="false" /></td>
          <td>
            <UiPill :tone="count.status === 'confirmed' ? 'good' : 'warn'">
              {{ count.status === 'confirmed' ? 'potvrđeno' : 'čeka potvrdu' }}
            </UiPill>
          </td>
          <td class="r">
            <NuxtLink :to="`/admin/roba/popisi/${count.id}`" class="a-go" aria-label="Otvori popis">
              <UiIcon name="chevron-right" :size="20" />
            </NuxtLink>
          </td>
        </tr>
      </UiTable>

      <p v-if="!loading && counts.length === 0" class="a-muted">
        Nema popisa za ovaj filter.
      </p>
    </UiCard>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.a-error { margin: 0; color: var(--danger); font-size: var(--text-label); }
.a-muted { margin: 0; color: var(--muted); font-size: var(--text-label); }
.a-nowrap { white-space: nowrap; }
.a-go { color: var(--muted); display: inline-flex; align-items: center; justify-content: flex-end; min-height: 24px; }
.a-go:hover { color: var(--accent-ink); }

@media (max-width: 1023px) {
  .a-go { min-height: 44px; min-width: 44px; }
}
</style>
