<script setup lang="ts">
/**
 * *Izvoz* — the four CSV files, over the period the picker names.
 *
 * The URLs come from `shared/types/export.ts` through `exportUrl()`, which the
 * server's own tests use as well, so a filter this page offers is a filter the
 * route implements. Nothing here writes a path.
 *
 * **Šank is not a fiscal device.** Every file ends with the line
 * *interni izvještaj — nije fiskalni*, and the page says so above the cards, so
 * nobody hands one of these to an inspector believing it is a receipt.
 */
import type { CountView } from '#shared/types'
import { EXPORTS, EXPORT_DISCLAIMER, exportUrl } from '#shared/types/export'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Izvoz' })

const api = useAdminApi()
const route = useRoute()
const period = useAdminPeriod()

/** *Stavke*: initials by default, full names only on the explicit toggle. */
const names = ref<'inicijali' | 'puna'>('inicijali')

const counts = ref<CountView[]>([])
const countId = ref(String(route.query.popis ?? ''))
const countsError = ref('')

onMounted(async () => {
  try {
    /*
     * `GET /api/stock/counts` answers `listCounts()`, which is `CountView[]` —
     * the count's id is `id`. `useAdminApi().getCounts()` is typed
     * `PendingCount[]` (whose id field is `count_id`), which is a WP0 signature
     * this package does not own and must not edit, so the answer is read here
     * through the shape the route actually returns.
     */
    counts.value = await api.getCounts() as unknown as CountView[]
  } catch (err) {
    countsError.value = apiErrorText(err, 'Popisi se nisu učitali.')
  }
})

/** A count the owner can recognise: when it was, who counted, and its state. */
function countLabel(count: CountView): string {
  const kind = count.kind === 'full' ? 'Popis' : 'Brzi popis'
  const state = count.status === 'confirmed' ? 'potvrđen' : 'predan'
  return `${dateBs(count.submitted_at)} ${timeBs(count.submitted_at)} · ${kind}`
    + ` · ${count.counted_by_name} · ${state}`
}

const countOptions = computed(() => [
  { value: '', label: counts.value.length ? 'Izaberi popis' : 'Nema popisa' },
  ...counts.value.map(count => ({ value: count.id, label: countLabel(count) })),
])

const range = computed(() => period.range.value)

const links = computed(() => ({
  smjene: exportUrl('smjene', range.value),
  dnevniPazar: exportUrl('dnevni-pazar', range.value),
  stavke: exportUrl('stavke', { ...range.value, full_names: names.value === 'puna' }),
  popis: exportUrl('popis', { count_id: countId.value }),
}))
</script>

<template>
  <div class="a-page">
    <UiPageHead eyebrow="Podešavanje" title="Izvoz" sub="CSV fajlovi za izabrani period" />

    <UiCard title="Period">
      <UiPeriod />
      <p class="a-note">
        Fajlovi su UTF-8 sa BOM oznakom i tačka-zarezom (<code>;</code>) između kolona,
        pa se u Excelu otvaraju sa ispravnim č, ć, š, ž i đ. Iznosi se pišu sa zarezom
        (1250,50). Svaki fajl završava redom „{{ EXPORT_DISCLAIMER }}“.
      </p>
    </UiCard>

    <div class="i-grid">
      <IzvozCard :spec="EXPORTS.smjene" :href="links.smjene" />

      <IzvozCard :spec="EXPORTS['dnevni-pazar']" :href="links.dnevniPazar" />

      <IzvozCard
        :spec="EXPORTS.stavke"
        :href="links.stavke"
        hint="Konobari se pišu inicijalima. Puna imena samo ako ih namjerno uključiš."
      >
        <UiSeg
          v-model="names"
          label="Kako se pišu konobari"
          :options="[
            { value: 'inicijali', label: 'Inicijali' },
            { value: 'puna', label: 'Puna imena' },
          ]"
        />
      </IzvozCard>

      <IzvozCard
        :spec="EXPORTS.popis"
        :href="links.popis"
        :disabled="!countId"
        :hint="countsError || 'Popis je jedan trenutak na polici, pa se bira pojedinačno.'"
      >
        <UiField
          v-model="countId"
          label="Popis"
          kind="select"
          :options="countOptions"
          :disabled="counts.length === 0"
        />
      </IzvozCard>
    </div>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }




.a-note { margin: 0; color: var(--muted); font-size: var(--text-micro); max-width: 70ch; }
/* The one `<code>` on the page is a single semicolon; it takes the app's own
   face with tabular figures rather than a third typeface written out by hand. */
.a-note code { font-family: var(--font-sans); font-variant-numeric: tabular-nums; color: var(--ink-2); }

.i-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  align-items: stretch;
}

/* One column on a phone; the cards are already full-width targets there. */
@media (max-width: 1023px) {
  .i-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
