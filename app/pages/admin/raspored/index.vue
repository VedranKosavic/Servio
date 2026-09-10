<script setup lang="ts">
/**
 * `/admin/raspored` — the owner's roster, in three tabs.
 *
 * *Sedmica* is the week itself, *Zamjene* every swap request, *Sati* the month
 * planned against worked. They are three reads of three different shapes, so
 * each tab owns its own load and its own subscription to the one `/admin` poll;
 * this file is the frame and the tab in the URL.
 *
 * The tab lives in `?tab=` rather than in a `ref` for the same reason the period
 * does on *Smjene*: a laptop tab left open on *Sati* and reloaded comes back on
 * *Sati*, and a link the owner sends himself opens where he meant it to.
 *
 * **`today` is a business date, not the laptop's.** The café's day starts at
 * 06:00 Europe/Sarajevo, so at 01:30 the owner is still working Friday and the
 * grid must still highlight Friday. Every "is this in the past" question on this
 * screen is answered against this one string.
 */
import { businessDate } from '#shared/dates'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Raspored' })

const route = useRoute()
const router = useRouter()
const me = useMe()

const TABS = [
  { value: 'sedmica', label: 'Sedmica' },
  { value: 'zamjene', label: 'Zamjene' },
  { value: 'sati', label: 'Sati' },
]

const tab = computed({
  get: () => (TABS.some(t => t.value === route.query.tab) ? String(route.query.tab) : 'sedmica'),
  set: value => void router.replace({ query: { ...route.query, tab: value } }),
})

const today = computed(() => businessDate(
  new Date().toISOString(),
  me.settings.value?.timezone,
  me.settings.value?.business_day_start_hour,
))
</script>

<template>
  <div class="a-page">
    <header class="a-page-head">
      <h1>Raspored</h1>
      <p class="a-page-sub">Sedmica, zamjene i sati</p>
    </header>

    <UiSeg v-model="tab" :options="TABS" label="Dio rasporeda" />

    <!-- `ClientOnly`: the business date is resolved from the venue's settings,
         which only exist once the client-only session envelope has loaded. -->
    <ClientOnly>
      <RasporedWeekTab v-if="tab === 'sedmica'" :today="today" />
      <RasporedZamjene v-else-if="tab === 'zamjene'" />
      <RasporedSati v-else :today="today" />
    </ClientOnly>
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

/* A wide table scrolls inside its own box; the page body never does. */
.a-page :deep(.a-table-wrap) { contain: paint; }

@media (max-width: 1023px) {
  .a-page-head h1 { font-size: 24px; }
}
</style>
