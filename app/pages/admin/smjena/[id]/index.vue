<script setup lang="ts">
/**
 * *Smjena* — one night, top to bottom.
 *
 * Everything on this page comes from **one** read, `GET /api/owner/shift/:id`,
 * which answers the shift, its written summary, the šanker's closing and what
 * arrived after closing.
 *
 * **The owner's cut.** The tiles are down to *Pazar* and *Predano*:
 * gotovina/kartica, gratis and storna, razlika gotovine, manjak robe and lule
 * went, and so did *Popisi*, *Po konobaru* and the review form
 * (*Ukupno s terminala*, *Pregledano*). *Kasa* is no longer
 * the drawer reconciliation — nobody counts cash any more — it is the šanker's
 * *Zaključi smjenu*: Sav prihod, the deductions and *Za predati*, as stored.
 *
 * The refetch is the shell's poll (`useAdminChanges`), narrowed to the entities
 * that can change what is on this page. There is no `setInterval` here.
 */
import { shiftCrew, shiftSlotName } from '~/components/smjena/smjeneDays'
import type { OwnerShift, ShiftTemplateView } from '#shared/types'

definePageMeta({ middleware: 'admin', layout: 'admin' })

const route = useRoute()
const api = useAdminApi()
const me = useMe()
useAdminChanges({
  onEntity: (entity) => {
    if (entity === 'shift' || entity === 'adjustment' || entity === 'stock') void load()
  },
})

const shiftId = computed(() => String(route.params.id))

const data = ref<OwnerShift | null>(null)
/** Prva / Druga smjena windows, read once: a template does not move mid-page. */
const templates = ref<ShiftTemplateView[] | null>(null)
const loading = ref(true)
const error = ref('')

async function load() {
  try {
    const [shift, slots] = await Promise.all([
      api.getShift(shiftId.value),
      templates.value ? Promise.resolve(templates.value) : api.getShiftTemplates().catch(() => []),
    ])
    data.value = shift
    templates.value = slots
    error.value = ''
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

/**
 * The read happens in the browser, not during the server render: the session
 * is a httpOnly cookie and a server-side `$fetch` would go out without it.
 */
onMounted(load)

/** *Prva smjena* / *Druga smjena*, from the opening time against the templates. */
const title = computed(() => data.value
  ? shiftSlotName(data.value.shift.opened_at, templates.value ?? [])
  : 'Smjena')

/** Konobari who locked rounds, and the šanker who closed it. */
const crew = computed(() => data.value
  ? shiftCrew(data.value.by_user, data.value.closing)
  : { konobari: [], sanker: null })

useHead({
  title: () => data.value ? `${title.value} ${dateBs(data.value.shift.business_date)}` : 'Smjena',
})

/**
 * `user_id` → name, from the rows this page already holds, so the header never
 * renders a UUID for `closed_by` or `reviewed_by`.
 */
const names = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {}
  const shift = data.value
  if (me.user.value) map[me.user.value.id] = me.user.value.name
  if (!shift) return map

  map[shift.shift.opened_by] = shift.shift.opened_by_name
  for (const user of shift.by_user) map[user.user_id] = user.name
  for (const s of shift.settlements) {
    map[s.user_id] = s.user_name
    if (s.accepted_by && s.accepted_by_name) map[s.accepted_by] = s.accepted_by_name
  }
  for (const m of shift.cash_movements) {
    map[m.user_id] = m.user_name
    map[m.created_by] = m.created_by_name
  }
  if (shift.closing) map[shift.closing.closed_by] = shift.closing.closed_by_name
  return map
})

</script>

<template>
  <div class="a-page">
    <p v-if="error" class="a-error">{{ error }}</p>

    <template v-if="data">
      <SmjenaHeader :shift="data.shift" :names="names" :title="title" :crew="crew" />

      <div class="a-tiles">
        <UiTile label="Pazar" :value="formatAmount(data.summary.promet_fen)" unit="KM" />
        <!-- The šanker's Za predati, beside the takings it came from. -->
        <UiTile
          label="Predano"
          :value="data.closing ? signedAmount(data.closing.za_predati_fen) : '—'"
          :unit="data.closing ? 'KM' : undefined"
          :tone="data.closing && data.closing.za_predati_fen < 0 ? 'bad' : 'plain'"
          :sub="data.closing ? 'za predati' : 'smjena nije zaključena'"
        />
      </div>

      <!-- *Kasa* is the šanker's close: Sav prihod, the deductions, Za predati. -->
      <SmjenaClosingCard :closing="data.closing ?? null" />

      <SmjenaCategoryBar :shift-id="data.shift.id" :categories="data.summary.by_category" />

      <SmjenaAfterClose :late="data.late_after_close" />
    </template>

    <!-- A skeleton, not a spinner over stale numbers. -->
    <div v-else-if="loading" class="a-skeleton">
      <span v-for="n in 3" :key="n" />
    </div>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 18px; min-width: 0; }

/* One tile now; the grid keeps it the width a tile has always had. */
.a-tiles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.a-error { margin: 0; color: var(--danger); }

.a-skeleton {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.a-skeleton span {
  display: block;
  min-height: 92px;
  border-radius: 12px;
  background: var(--surface-2);
}

@media (max-width: 1023px) {
  .a-tiles, .a-skeleton { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
