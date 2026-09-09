<script setup lang="ts">
/**
 * *Stavke* — the drill-down behind every number on the Smjena page.
 *
 * The two filters live in the route query (`?user=&kat=`), which is what makes
 * a chip on the strip a plain link: the strip does not have to talk to this
 * page, it just points at a URL, and that URL is shareable and survives a
 * reload.
 *
 * Two reads, both cheap: the shift itself for the filter option lists and the
 * header, and the paged lines. Changing a filter starts a fresh first page;
 * *Učitaj još* appends the next one through the keyset cursor.
 */
import { KAT_PRESETS } from '~/components/smjena/smjenaLogic'
import type { LineRow, LineTotals, OwnerShift } from '#shared/types'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Stavke' })

const route = useRoute()
const router = useRouter()
const api = useAdminApi()

const shiftId = computed(() => String(route.params.id))
const user = computed(() => String(route.query.user ?? ''))
const kat = computed(() => String(route.query.kat ?? 'sve'))

const shift = ref<OwnerShift | null>(null)
const rows = ref<LineRow[]>([])
const totals = ref<LineTotals | null>(null)
const cursor = ref<string | undefined>(undefined)
const loading = ref(true)
const loadingMore = ref(false)
const error = ref('')

async function loadShift() {
  try {
    shift.value = await api.getShift(shiftId.value)
  } catch (err) {
    error.value = apiErrorText(err)
  }
}

/** A fresh first page. Every filter change comes through here. */
async function loadLines() {
  loading.value = true
  try {
    const page = await api.getShiftLines(shiftId.value, {
      ...(user.value ? { user: user.value } : {}),
      kat: kat.value,
    })
    rows.value = page.rows
    totals.value = page.totals
    cursor.value = page.next_cursor
    error.value = ''
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

/** The next page, appended. `cursor` names the last row we hold, not an offset. */
async function loadMore() {
  if (!cursor.value) return
  loadingMore.value = true
  try {
    const page = await api.getShiftLines(shiftId.value, {
      ...(user.value ? { user: user.value } : {}),
      kat: kat.value,
      cursor: cursor.value,
    })
    rows.value = [...rows.value, ...page.rows]
    totals.value = page.totals
    cursor.value = page.next_cursor
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    loadingMore.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadShift(), loadLines()])
})

watch([user, kat], () => { void loadLines() })

// -- the filters -------------------------------------------------------------

/** *Svi konobari* plus everybody who worked this night. */
const userOptions = computed(() => [
  { value: '', label: 'Svi konobari' },
  ...(shift.value?.by_user ?? []).map(u => ({ value: u.user_id, label: u.name })),
])

/** The four presets the server understands, then the night's own categories. */
const katOptions = computed(() => [
  ...KAT_PRESETS.map(preset => ({ value: preset.value, label: preset.label })),
  ...(shift.value?.summary.by_category ?? [])
    .filter(c => c.qty > 0)
    .map(c => ({ value: c.category_id, label: c.name ?? '—' })),
])

/** Written with `replace`, so Back leaves the page rather than the filter. */
function setQuery(patch: Record<string, string>) {
  const query = { ...route.query, ...patch }
  for (const [key, value] of Object.entries(query)) {
    if (value === '' || value === undefined) delete query[key]
  }
  void router.replace({ query })
}

const userModel = computed({
  get: () => user.value,
  set: (value: string | number | null) => setQuery({ user: String(value ?? '') }),
})

const katModel = computed({
  get: () => kat.value,
  set: (value: string | number | null) => setQuery({ kat: String(value ?? 'sve') }),
})

const subtitle = computed(() => {
  if (!shift.value) return ''
  const person = shift.value.by_user.find(u => u.user_id === user.value)?.name
  const category = katOptions.value.find(o => o.value === kat.value)?.label
  return [dateBs(shift.value.shift.business_date), person, category].filter(Boolean).join(' · ')
})
</script>

<template>
  <div class="a-page">
    <header class="a-page-head">
      <NuxtLink :to="`/a/smjena/${shiftId}`" class="a-back">Nazad na smjenu</NuxtLink>
      <h1>Stavke</h1>
      <p class="a-page-sub">{{ subtitle }}</p>
    </header>

    <UiCard title="Filter">
      <div class="a-filters">
        <UiField v-model="userModel" label="Konobar" kind="select" :options="userOptions" />
        <UiField v-model="katModel" label="Kategorija" kind="select" :options="katOptions" />
      </div>
    </UiCard>

    <p v-if="error" class="a-error">{{ error }}</p>

    <SmjenaLines
      :rows="rows"
      :totals="totals"
      :loading="loading"
      :has-more="!!cursor"
      :loading-more="loadingMore"
      @more="loadMore"
    />
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 18px; min-width: 0; }

.a-back {
  color: var(--accent-ink);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  min-height: 24px;
}

.a-back:hover { text-decoration: underline; }

.a-page-head h1 {
  font-family: var(--font-title);
  font-weight: 700;
  font-size: 28px;
  letter-spacing: -0.015em;
  margin: 2px 0 0;
  line-height: 1.1;
}

.a-page-sub { margin: 2px 0 0; color: var(--muted); font-size: 14px; }
.a-error { margin: 0; color: var(--danger); }

.a-filters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 240px));
  gap: 12px;
}

@media (max-width: 1023px) {
  .a-filters { grid-template-columns: minmax(0, 1fr); }
  .a-back { min-height: 44px; }
}
</style>
