<script setup lang="ts">
/**
 * *Smjene* — one row per night in the period, newest first.
 *
 * The whole page is one read (`GET /api/owner/shifts?from&to`) under one period
 * control. The period lives in the route query rather than in a `ref`, so a tab
 * the owner leaves open and reloads comes back on the same range, and a link he
 * sends himself opens on it.
 *
 * It refetches on `shift` moving in the change feed and on nothing else: there
 * is one poll on `/admin` and this page subscribes to it rather than opening a
 * timer of its own.
 *
 * **Two layouts, one page.** At a desk this is a table and it should be: six
 * columns of eight nights, compared down a column. In a hand it was a 390 px box
 * cut off at the right edge with a scrollbar under it — and the two columns over
 * the edge were the pazar and the razlika, the only two the owner came for. So
 * below 1024 px the table is gone and the nights are a list (`SmjenaNights`),
 * and the six period chips — which wrapped onto two rows and spent a third of
 * the screen — become one row of arrow · period · arrow (`SmjenaPeriod`), with
 * all six and *Prilagođeno* one tap behind the middle. Nothing on this screen
 * scrolls sideways at any width.
 *
 * **`useMounted` is not optional there.** `useMediaQuery` answers truthfully
 * from the first client render, and the server — which has no viewport — always
 * says the laptop. Without the gate the two renders disagree about the whole
 * page and Vue throws the server's markup away with a hydration mismatch. So the
 * first paint is the table at both widths, and the phone swaps to the list on
 * mount, which happens before the first read lands: what the owner actually sees
 * appear is the list.
 */
import { shiftStatusPill } from '~/components/smjena/smjenaLogic'
import type { OwnerShiftRow } from '#shared/types'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Smjene' })

const api = useAdminApi()
const route = useRoute()

/** The dashboard's own breakpoint — the width `admin.css` changes density at. */
const mounted = useMounted()
const narrow = useMediaQuery('(max-width: 1023px)')
const isPhone = computed(() => mounted.value && narrow.value)

/**
 * Both period controls build their own `useAdminPeriod()` with the kit's
 * default, so this page must use the same default or the control and the range
 * would disagree. A week is the more useful opening range here, so instead of a
 * different fallback the page *writes* one into the query the first time it is
 * opened — every instance then reads the same URL.
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
    <UiPageHead eyebrow="Lokal" title="Smjene" sub="Svaka noć, i šta je od nje ostalo u kasi" />

    <!-- ---- the phone ------------------------------------------------- -->
    <SmjenaPeriod v-if="isPhone" />

    <!-- ---- the laptop ------------------------------------------------ -->
    <UiCard v-else quiet>
      <UiPeriod />
    </UiCard>

    <p v-if="error" class="a-error">{{ error }}</p>

    <SmjenaNights v-if="isPhone" :rows="rows" :loading="loading" :total="total" />

    <UiCard v-else title="Smjene" :count="`${rows.length}`" flush>
      <template #actions>
        <span class="a-total">
          <span class="a-total-label">Ukupno</span>
          <UiMoney class="a-total-value" :fen="total" :colour="false" />
        </span>
      </template>

      <p v-if="!loading && !rows.length" class="a-muted">
        U ovom periodu nema nijedne smjene.
      </p>

      <UiTable v-else :columns="columns" :loading="loading" hover>
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
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }


.a-muted { margin: 0 20px; color: var(--muted); font-size: var(--text-label); }
.a-quiet { color: var(--muted); }
.a-error { margin: 0; color: var(--danger); font-size: var(--text-label); }

.a-total { display: inline-flex; align-items: baseline; gap: 8px; }

.a-total-label {
  font-size: var(--text-caption);
  letter-spacing: 0.09em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--muted);
}

.a-total-value {
  font-family: var(--font-display);
  font-size: var(--text-section);
  font-weight: 700;
  color: var(--ink);
}

/* The links fill their cells. A date rendered inline is a 17 px target and the
   chevron a 20 px one — both well under the 44 px floor DESIGN §3 puts on
   anything inline in a dense row. The table itself is a laptop's, so there is
   no phone rule under this one: below 1024 px `SmjenaNights` has the nights. */
.a-row :deep(a) {
  display: flex;
  align-items: center;
  min-height: var(--tap);
  color: inherit;
  text-decoration: none;
  font-weight: 600;
}

.a-row :deep(td.r a) { justify-content: flex-end; }
.a-row :deep(a:hover) { text-decoration: underline; }
</style>
