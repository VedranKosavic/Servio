<script setup lang="ts">
/**
 * `/admin/raspored` — the owner's roster: one weekly pattern, and nothing else.
 *
 * No dates, no week arrows, nothing to publish: seven weekdays × the shifts, at
 * most two people per shift, and an edit is saved for every week at once.
 *
 * **`today` is the business day's weekday, not the laptop's.** The café's day
 * starts at 06:00 Europe/Sarajevo, so at 01:30 on Saturday the owner is still
 * working Friday and the grid must still highlight Friday.
 */
import { businessDate, isoWeekday } from '#shared/dates'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Raspored' })

const me = useMe()

const today = computed(() => isoWeekday(businessDate(
  new Date().toISOString(),
  me.settings.value?.timezone,
  me.settings.value?.business_day_start_hour,
)))
</script>

<template>
  <div class="a-page">
    <UiPageHead eyebrow="Ljudi" title="Raspored" sub="Sedmica po smjenama" />

    <!-- `ClientOnly`: the business day is resolved from the venue's settings,
         which only exist once the client-only session envelope has loaded. -->
    <ClientOnly>
      <RasporedPatternTab :today="today" />
    </ClientOnly>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

/* A wide table scrolls inside its own box; the page body never does. */
.a-page :deep(.a-table-wrap) { contain: paint; }

@media (max-width: 1023px) {
  .a-page { gap: 14px; }
  .a-page :deep(.a-head-sub) { display: none; }
}
</style>
