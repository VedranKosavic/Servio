<script setup lang="ts">
/**
 * *Sati* — planned against worked, one month, every person. `/admin`, light kit.
 *
 * **"Prva akcija nije dolazak."** That sentence is printed on the page, not
 * hidden in a tooltip, and it is the whole ethic of this table (PLAN §8). The
 * server has no clock-in: what it knows is when somebody first touched the app
 * on a night. A waiter who arrived at 16:00, carried chairs in from the terrace
 * and locked his first round at 16:40 shows "+40 min" here — which is evidence
 * for a conversation and never a flag, and the owner has to be able to read that
 * off the screen without being told.
 *
 * Two rows the table prints that are not shifts, because leaving them out would
 * make the month look tidier than it was:
 *
 * - ***radio bez rasporeda*** — he was there and is not on the plan;
 * - ***planirano, nema smjene*** — the plan with nobody behind it.
 *
 * The šanker submits counts and never locks a shift, so his nights come from the
 * same `shift_members` rows as everybody's; nothing here treats him specially
 * and nothing flags him for not having a settlement.
 */
import type { HoursRow } from '#shared/types'

const props = defineProps<{ today: string }>()

const api = useAdminApi()

const month = ref(props.today.slice(0, 7))
const rows = ref<HoursRow[]>([])
const loading = ref(true)
const error = ref('')
const open = ref<string | null>(null)

async function load() {
  try {
    rows.value = await api.getRosterHours(month.value)
    error.value = ''
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(month, () => { loading.value = true; void load() })

useAdminChanges({
  onEntity: (entity) => { if (entity === 'roster' || entity === 'shift') void load() },
})

/** Never past the current month: an empty October in September is a bug report. */
const atNow = computed(() => month.value >= props.today.slice(0, 7))
const step = (by: number) => { if (by < 0 || !atNow.value) month.value = shiftMonth(month.value, by) }

const columns = [
  { key: 'who', label: 'Osoba' },
  { key: 'planned', label: 'Planirano', align: 'r' as const },
  { key: 'worked', label: 'Odrađeno', align: 'r' as const },
  { key: 'late', label: 'Kašnjenje', align: 'r' as const },
  { key: 'early', label: 'Raniji odlazak', align: 'r' as const },
  { key: 'sick', label: 'Bolovanje', align: 'r' as const },
  { key: 'absent', label: 'Nije došao', align: 'r' as const },
  { key: 'swaps', label: 'Zamjene', align: 'r' as const },
]

function toggle(userId: string) {
  open.value = open.value === userId ? null : userId
}

/**
 * The day's own line: which shift it was.
 *
 * The two notes — *radio bez rasporeda*, *planirano, nema smjene* — are pills
 * beside it and not instead of it, so a planned night with nobody behind it
 * still says **which** shift was left uncovered.
 */
function dayLine(day: HoursRow['days'][number]): string {
  if (day.status === 'unplanned') return HOURS_NOTE_BS.unplanned
  return `${day.template_name ?? '—'} ${day.start_time && day.end_time
    ? timeSpanBs(day.start_time, day.end_time)
    : ''}`.trim()
}

/** "prva tura 16:40 (+40 min)" — the evidence, spelled out. */
function firstLine(day: HoursRow['days'][number]): string {
  if (!day.first_action) return ''
  return `prva tura ${timeBs(day.first_action)}${day.late_min > 0 ? ` (${lateBs(day.late_min)})` : ''}`
}
</script>

<template>
  <div class="r-tab">
    <UiCard title="Sati">
      <template #actions>
        <div class="r-month">
          <UiButton small variant="soft" aria-label="Prethodni mjesec" @click="step(-1)">‹</UiButton>
          <strong>{{ monthBs(month) }}</strong>
          <UiButton small variant="soft" :disabled="atNow" aria-label="Sljedeći mjesec" @click="step(1)">›</UiButton>
        </div>
      </template>

      <p v-if="error" class="r-error" role="alert">{{ error }}</p>

      <p v-if="!loading && hoursEmpty(rows)" class="r-quiet">
        U ovom mjesecu nema ni rasporeda ni odrađenih smjena.
      </p>

      <UiTable v-else :columns="columns" :loading="loading">
        <template v-for="row in rows" :key="row.user_id">
          <tr class="r-row" @click="toggle(row.user_id)">
            <td>
              <strong>{{ row.user_name }}</strong>
              <br>
              <small class="r-quiet">
                {{ open === row.user_id ? 'sakrij dane' : 'prikaži dane' }}
              </small>
            </td>
            <td class="r-n">{{ row.planned_shifts }} · {{ hoursBs(row.planned_h) }}</td>
            <td class="r-n">{{ hoursBs(row.worked_h) }}</td>
            <td class="r-n">{{ row.late_min ? `${row.late_min} min` : '—' }}</td>
            <td class="r-n">{{ row.early_leave_min ? `${row.early_leave_min} min` : '—' }}</td>
            <td class="r-n">{{ row.sick_days || '—' }}</td>
            <td class="r-n">{{ row.absent_days || '—' }}</td>
            <td class="r-n">{{ row.swaps_given }} / {{ row.swaps_taken }}</td>
          </tr>

          <tr v-if="row.unplanned_rows || row.no_shift_rows" class="r-flags">
            <td :colspan="8">
              <UiPill v-if="row.unplanned_rows" tone="warn">
                {{ HOURS_NOTE_BS.unplanned }} · {{ row.unplanned_rows }}
              </UiPill>
              <UiPill v-if="row.no_shift_rows" tone="neutral">
                {{ HOURS_NOTE_BS.noShift }} · {{ row.no_shift_rows }}
              </UiPill>
            </td>
          </tr>

          <tr v-if="open === row.user_id" class="r-days">
            <td :colspan="8">
              <p v-if="!row.days.length" class="r-quiet">Nema nijednog dana.</p>
              <div v-for="day in row.days" :key="`${day.business_date}-${day.template_name ?? 'x'}`" class="r-day">
                <span class="r-date">{{ dayLabelBs(day.business_date) }}</span>
                <span class="r-what">{{ dayLine(day) }}</span>
                <span class="r-when">{{ firstLine(day) }}</span>
                <span class="r-n">{{ hoursBs(day.worked_h) }}</span>
                <UiPill v-if="day.status !== 'planned' && day.status !== 'unplanned'" tone="neutral">
                  {{ STATUS_BS[day.status] }}
                </UiPill>
                <UiPill v-else-if="day.status === 'unplanned'" tone="warn">
                  {{ HOURS_NOTE_BS.unplanned }}
                </UiPill>
                <UiPill v-if="day.no_shift_row" tone="neutral">
                  {{ HOURS_NOTE_BS.noShift }}
                </UiPill>
                <small v-if="day.left_auto" class="r-quiet">smjena zatvorena automatski</small>
              </div>
            </td>
          </tr>
        </template>
      </UiTable>

      <p class="r-caveat">
        Prva akcija nije dolazak. Vrijeme prve ture je dokaz za razgovor, ne
        ocjena — neko prvo unosi stolice, neko pere šank.
      </p>
      <p class="r-quiet">
        Zamjene su prikazane kao "dao / uzeo". Bolovanje se ne vidi nigdje osim
        ovdje, u Zamjenama i u Dnevniku.
      </p>
    </UiCard>
  </div>
</template>

<style scoped>
.r-tab { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

.r-month { display: flex; align-items: center; gap: 8px; }
.r-month strong { font-size: 14px; min-width: 120px; text-align: center; }

.r-n { font-variant-numeric: tabular-nums; white-space: nowrap; }
.r-quiet { margin: 0; color: var(--muted); font-size: 13px; }
.r-error { margin: 0; color: var(--danger); font-weight: 500; }

.r-caveat {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 13px;
}

.r-row { cursor: pointer; }
.r-flags :deep(.a-pill) + :deep(.a-pill) { margin-left: 6px; }

.r-days td { background: var(--surface-2); }

.r-day {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  padding: 4px 0;
  font-size: 13px;
}

.r-date { font-weight: 600; min-width: 90px; font-variant-numeric: tabular-nums; }
.r-what { min-width: 140px; }
.r-when { color: var(--ink-2); font-variant-numeric: tabular-nums; }

@media (max-width: 1023px) {
  .r-row :deep(td) { padding-top: 14px; padding-bottom: 14px; }
  .r-month strong { min-width: 100px; }
}
</style>
