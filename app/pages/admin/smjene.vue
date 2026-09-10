<script setup lang="ts">
/**
 * *Smjene* — one row per night in the period, newest first.
 *
 * The whole page is one read (`GET /api/owner/shifts?from&to`) under one
 * `UiPeriod`. The period lives in the route query rather than in a `ref`, so a
 * tab the owner leaves open and reloads comes back on the same range, and a link
 * he sends himself opens on it.
 *
 * It refetches on `shift` moving in the change feed and on nothing else: there
 * is one poll on `/admin` and this page subscribes to it rather than opening a
 * timer of its own.
 */
import { shiftStatusPill } from '~/components/smjena/smjenaLogic'
import type { OwnerShiftRow } from '#shared/types'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Smjene' })

const api = useAdminApi()
const route = useRoute()

/**
 * `UiPeriod` builds its own `useAdminPeriod()` with the kit's default, so this
 * page must use the same default or the chips and the range would disagree.
 * A week is the more useful opening range here, so instead of a different
 * fallback the page *writes* one into the query the first time it is opened —
 * both instances then read the same URL.
 */
const period = useAdminPeriod()

onMounted(() => {
  if (!route.query.period && !route.query.from) period.setPeriod('ova-sedmica')
})

const rows = ref<OwnerShiftRow[]>([])
const loading = ref(true)
const error = ref('')

async function load() {
  try {
    rows.value = await api.getShifts(period.range.value)
    error.value = ''
  } catch (err) {
    // An honest empty screen: a stale list of takings is worse than none.
    error.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

watch(period.range, load, { immediate: true })

useAdminChanges({
  onEntity: (entity) => { if (entity === 'shift') void load() },
})

const columns = [
  { key: 'datum', label: 'Datum' },
  { key: 'status', label: 'Status' },
  { key: 'vrijeme', label: 'Otvorena — zatvorena' },
  { key: 'promet', label: 'Pazar', align: 'r' as const },
  { key: 'razlika', label: 'Razlika', align: 'r' as const },
  { key: 'chevron', label: '', width: '40px' },
]

/** The nights in the period, plus what they add up to. */
const total = computed(() => rows.value.reduce((sum, row) => sum + row.promet_fen, 0))
</script>

<template>
  <div class="a-page">
    <header class="a-page-head">
      <h1>Smjene</h1>
      <p class="a-page-sub">Svaka noć, i šta je od nje ostalo u kasi</p>
    </header>

    <UiCard>
      <UiPeriod />
    </UiCard>

    <p v-if="error" class="a-error">{{ error }}</p>

    <UiCard title="Smjene" :count="rows.length">
      <template #actions>
        <span class="a-total">Ukupno <UiMoney :fen="total" :colour="false" /></span>
      </template>

      <p v-if="!loading && !rows.length" class="a-muted">
        U ovom periodu nema nijedne smjene.
      </p>

      <UiTable v-else :columns="columns" :loading="loading">
        <tr v-for="row in rows" :key="row.id" class="a-row">
          <td>
            <NuxtLink :to="`/admin/smjena/${row.id}`">{{ dateBs(row.business_date) }}</NuxtLink>
          </td>
          <td>
            <UiPill :tone="shiftStatusPill(row.status).tone">
              {{ shiftStatusPill(row.status).word }}
            </UiPill>
          </td>
          <td class="a-quiet">
            {{ timeBs(row.opened_at) }}<template v-if="row.closed_at"> — {{ timeBs(row.closed_at) }}</template>
            <template v-else> — u toku</template>
          </td>
          <td class="r"><UiMoney :fen="row.promet_fen" :currency="false" :colour="false" /></td>
          <td class="r">
            <UiMoney v-if="row.diff_fen !== null" :fen="row.diff_fen" :currency="false" />
            <span v-else class="a-quiet">—</span>
          </td>
          <td class="r">
            <NuxtLink :to="`/admin/smjena/${row.id}`" aria-label="Otvori smjenu">
              <UiIcon name="chevron-right" :size="20" />
            </NuxtLink>
          </td>
        </tr>
      </UiTable>
    </UiCard>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 18px; min-width: 0; }

.a-page-head h1 {
  font-family: var(--font-title);
  font-weight: 700;
  font-size: 28px;
  letter-spacing: -0.015em;
  margin: 0;
  line-height: 1.1;
}

.a-page-sub { margin: 2px 0 0; color: var(--muted); font-size: 14px; }
.a-muted { margin: 0; color: var(--muted); }
.a-quiet { color: var(--muted); }
.a-error { margin: 0; color: var(--danger); }

.a-total { font-size: 14px; color: var(--ink-2); font-variant-numeric: tabular-nums; }

.a-row :deep(a) { color: inherit; text-decoration: none; font-weight: 600; }
.a-row :deep(a:hover) { text-decoration: underline; }

@media (max-width: 1023px) {
  /* The whole row is the target on a phone, so it clears 44 px on its own. */
  .a-row :deep(td) { padding-top: 14px; padding-bottom: 14px; }
}
</style>
