<script setup lang="ts">
/**
 * *Historija prijema* — every delivery note already concluded.
 *
 * It used to be a table sitting under the entry form, which meant the screen for
 * *writing* a delivery was mostly about deliveries already written. It is its
 * own page now, one small button away from the document, and its way back is
 * `UiPageHead`'s — `/admin/roba/prijem/historija` climbs to `/admin/roba/prijem`.
 *
 * **Every row says who entered it.** That is the point of keeping the archive at
 * all: a delivery is the one document on this dashboard that *adds* stock, and
 * the only thing standing between a booked crate and a crate that never arrived
 * is that the document carries a name the person entering it could not type. The
 * server takes the actor from the session (§5.7); no body ever names it.
 *
 * **Two layouts, one page.** A laptop gets the table — seven columns of
 * documents compared at a glance. A phone gets rows: the supplier and the date
 * on the row, the amount beside it, everything else (the articles, the reversal)
 * one tap behind it in `RobaPrijemDokument`. Nothing scrolls sideways at any
 * width.
 */
import { cutoffIso, nextBusinessDate } from '#shared/dates'
import type { DeliveryView } from '#shared/types'
import type { UiColumn } from '~/components/ui/UiTable.vue'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Roba — historija prijema' })

const api = useAdminApi()
const route = useRoute()

/** The dashboard's own breakpoint — the width `admin.css` changes density at. */
const mounted = useMounted()
const narrow = useMediaQuery('(max-width: 1023px)')
const isPhone = computed(() => mounted.value && narrow.value)

/**
 * `UiPeriod` builds its own `useAdminPeriod()` on the default fallback, so a
 * page that asked for a different one here would light up one chip and read a
 * different range. The default is kept and the wanted preset is written into the
 * URL instead — then both instances read the same answer.
 */
const period = useAdminPeriod()
if (!route.query.period && !route.query.from) period.setPeriod('ovaj-mjesec')

/**
 * `GET /api/stock/deliveries` compares `from` / `to` against
 * `deliveries.delivered_at`, which is a UTC **instant**, so a business day has
 * to be handed over as one: 06:00 local on the first day, to 06:00 local on the
 * day after the last. Sending the bare date would drop every delivery booked
 * after midnight on the closing day.
 */
function instantRange(): { from: string, to: string } {
  const { from, to } = period.range.value
  const end = new Date(Date.parse(cutoffIso(nextBusinessDate(to))) - 1)
  return { from: cutoffIso(from), to: end.toISOString() }
}

const deliveries = ref<DeliveryView[]>([])
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  try {
    deliveries.value = await api.getDeliveries(instantRange())
    error.value = ''
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

useAdminChanges({
  onEntity: (entity) => { if (entity === 'stock') void load() },
})

onMounted(() => { void load() })

watch(() => period.range.value, () => { void load() })

const COLUMNS: UiColumn[] = [
  { key: 'date', label: 'Datum' },
  { key: 'supplier', label: 'Dobavljač' },
  { key: 'lines', label: 'Stavke', align: 'r' },
  { key: 'total', label: 'Ukupno', align: 'r' },
  { key: 'who', label: 'Unio' },
  { key: 'status', label: 'Status' },
  { key: 'act', label: '' },
]

/**
 * The open document, **by id and not by object**: the reversal refetches the
 * list, and a sheet holding the old object would go on offering *Storniraj* on
 * a document the server has already reversed.
 */
const openId = ref<string | null>(null)
const openDelivery = computed(() =>
  deliveries.value.find(delivery => delivery.id === openId.value) ?? null)

const reversing = ref(false)
const reverseError = ref('')

watch(openId, () => { reverseError.value = '' })

async function reverse(note: string) {
  const target = openDelivery.value
  if (!target || reversing.value) return
  reversing.value = true
  reverseError.value = ''
  try {
    await api.reverseDelivery(target.id, { note })
    await load()
    openId.value = null
  } catch (err) {
    reverseError.value = apiErrorText(err)
  } finally {
    reversing.value = false
  }
}

/** What the period actually cost, reversals left out — they cost nothing. */
const total = computed(() => deliveries.value
  .filter(delivery => !delivery.reversed_at)
  .reduce((sum, delivery) => sum + delivery.total_fen, 0))
</script>

<template>
  <div class="a-page">
    <UiPageHead
      eyebrow="Lokal"
      title="Historija prijema"
      sub="proknjiženi dokumenti · ko ih je unio"
    />

    <p v-if="error" class="a-error">{{ error }}</p>

    <!-- No period label in the head: `UiPeriod` prints the range under its own
         chips, and the same dates twice pushed the heading onto three lines on
         a phone. -->
    <UiCard title="Proknjiženi prijemi" :count="`${deliveries.length} · ${formatKm(total)}`">
      <UiPeriod />

      <!-- ---- the phone ------------------------------------------------ -->
      <template v-if="isPhone">
        <div v-if="loading" class="h-card h-skel" aria-hidden="true">
          <div v-for="n in 4" :key="n" class="h-skel-row">
            <span class="h-skel-bar wide" />
            <span class="h-skel-bar" />
          </div>
        </div>

        <div v-else-if="deliveries.length > 0" class="h-card">
          <button
            v-for="delivery in deliveries"
            :key="delivery.id"
            type="button"
            class="h-row"
            :aria-label="`Dokument, ${delivery.supplier_name}`"
            @click="openId = delivery.id"
          >
            <span class="h-text">
              <span class="h-name">{{ delivery.supplier_name }}</span>
              <span class="h-meta">
                <span class="num">{{ dateBs(delivery.delivered_at) }}</span>
                · {{ delivery.entered_by_name }}
              </span>
            </span>

            <span class="h-right">
              <span class="h-total num">
                <UiMoney :fen="delivery.total_fen" :colour="false" />
              </span>
              <UiPill v-if="delivery.reversed_at" tone="bad">stornirano</UiPill>
            </span>
          </button>
        </div>

        <p v-else class="a-empty">U ovom periodu nema proknjiženih prijema.</p>
      </template>

      <!-- ---- the laptop ----------------------------------------------- -->
      <template v-else>
        <UiTable :columns="COLUMNS" :loading="loading">
          <tr v-for="delivery in deliveries" :key="delivery.id">
            <td class="a-nowrap num">{{ dateBs(delivery.delivered_at) }}</td>
            <td>{{ delivery.supplier_name }}</td>
            <td class="r num">{{ delivery.lines.length }}</td>
            <td class="r"><UiMoney :fen="delivery.total_fen" :currency="false" :colour="false" /></td>
            <td>{{ delivery.entered_by_name }}</td>
            <td>
              <UiPill :tone="delivery.reversed_at ? 'bad' : 'good'">
                {{ delivery.reversed_at ? 'stornirano' : 'proknjiženo' }}
              </UiPill>
            </td>
            <td class="a-acts">
              <UiButton small variant="ghost" @click="openId = delivery.id">Otvori</UiButton>
            </td>
          </tr>
        </UiTable>

        <p v-if="!loading && deliveries.length === 0" class="a-empty">
          U ovom periodu nema proknjiženih prijema.
        </p>
      </template>
    </UiCard>

    <RobaPrijemDokument
      :open="openDelivery !== null"
      :delivery="openDelivery"
      :pending="reversing"
      :error="reverseError"
      @close="openId = null"
      @reverse="reverse"
    />
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.a-error { margin: 0; color: var(--danger); font-size: var(--text-label); }
.a-empty { margin: 0; color: var(--muted); font-size: var(--text-label); }
.a-nowrap { white-space: nowrap; }
.a-acts { display: flex; gap: 6px; justify-content: flex-end; }

/* ---- the phone list ----------------------------------------------------- */

.h-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  overflow: hidden;
  min-width: 0;
}

.h-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px 10px;
  width: 100%;
  min-height: var(--tap);
  padding: 10px 14px;
  border: 0;
  border-bottom: 1px solid var(--line-soft);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}

.h-row:last-child { border-bottom: 0; }
.h-row:active { background: var(--bg); }
.h-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

.h-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }

.h-name {
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--ink);
  line-height: 1.3;
}

/* The date and the name who entered it, on the row and not behind the tap:
   between them they are the whole reason this archive exists. */
.h-meta { font-size: var(--text-micro); color: var(--muted); }

.h-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  white-space: nowrap;
}

.h-total { font-size: var(--text-body); font-weight: 600; color: var(--ink); }

.h-skel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 14px;
  border-bottom: 1px solid var(--line-soft);
}

.h-skel-row:last-child { border-bottom: 0; }

.h-skel-bar {
  display: block;
  height: 10px;
  width: 64px;
  border-radius: var(--radius-chip);
  background: var(--surface-2);
}

.h-skel-bar.wide { width: 45%; }
</style>
