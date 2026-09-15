<script setup lang="ts">
/**
 * `/admin/raspored` — the owner's roster: the week, and nothing else.
 *
 * **It used to be four tabs and is now one screen.** *Sati* (the month planned
 * against worked) and *Šabloni* are both gone — the templates screen went with
 * the rest of *Ostalo*, so the two the venue has (*Dnevna*, *Večernja*) are
 * whatever the seed wrote. *Zamjene* is gone too, with the swaps and sick days
 * themselves ("Ne trebaju nam zamjene i bolovanje"): nothing in the app raises a
 * request any more, so there is nothing for the owner to answer.
 *
 * **`today` is a business date, not the laptop's.** The café's day starts at
 * 06:00 Europe/Sarajevo, so at 01:30 the owner is still working Friday and the
 * grid must still highlight Friday. Every "is this in the past" question on this
 * screen is answered against this one string.
 */
import { businessDate } from '#shared/dates'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Raspored' })

const me = useMe()

const today = computed(() => businessDate(
  new Date().toISOString(),
  me.settings.value?.timezone,
  me.settings.value?.business_day_start_hour,
))
</script>

<template>
  <div class="a-page">
    <UiPageHead eyebrow="Ljudi" title="Raspored" sub="Sedmica po smjenama" />

    <!-- `ClientOnly`: the business date is resolved from the venue's settings,
         which only exist once the client-only session envelope has loaded. -->
    <ClientOnly>
      <RasporedWeekTab :today="today" />
    </ClientOnly>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

/* A wide table scrolls inside its own box; the page body never does. */
.a-page :deep(.a-table-wrap) { contain: paint; }

/**
 * The phone, where this screen is actually used.
 *
 * The sub line named the four tabs that were drawn two centimetres below it.
 * The tabs are gone and so is the repetition, so all that is left here is the
 * tighter gap a one-view screen wants.
 */
@media (max-width: 1023px) {
  .a-page { gap: 14px; }
  .a-page :deep(.a-head-sub) { display: none; }
}
</style>
