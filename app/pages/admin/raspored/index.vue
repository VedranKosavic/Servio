<script setup lang="ts">
/**
 * `/admin/raspored` — the owner's roster: the week, and nothing else.
 *
 * **It used to be four tabs and is now one screen.** *Sati* (the month planned
 * against worked) is gone; *Šabloni* lives at `/admin/postavke/sabloni` and the
 * week's own empty state is what points at it, which is the only moment anybody
 * needs it; *Zamjene* is at `/admin/raspored/zamjene` and is linked from the
 * strip below — but **only while somebody is actually waiting on an answer**.
 *
 * That last one is the only part of this worth explaining. A waiter can raise a
 * swap from `/konobar/raspored`, and the owner is the only person who can assign
 * or decline it (`POST /api/roster/swaps/:id/assign` is admin-only). The week
 * *shows* a pending swap — the chip goes amber and says *zamjena* — but it
 * cannot resolve one. So deleting the tab outright would have left a request a
 * waiter raised with no screen in the app able to answer it, and an amber chip
 * that never goes away. A line that appears when there is something to answer
 * and is invisible the rest of the time keeps the screen to one view and keeps
 * the flow whole.
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
const api = useAdminApi()

const today = computed(() => businessDate(
  new Date().toISOString(),
  me.settings.value?.timezone,
  me.settings.value?.business_day_start_hour,
))

/**
 * How many swap requests are waiting on the owner.
 *
 * One small read, and a silent failure on purpose: this is a signpost, not the
 * screen's content. If it cannot load, the week still draws — the owner has lost
 * a shortcut, not his roster.
 */
const pendingSwaps = ref(0)

async function loadSwaps() {
  try {
    pendingSwaps.value = (await api.listSwaps('pending')).length
  } catch {
    pendingSwaps.value = 0
  }
}

onMounted(loadSwaps)
useAdminChanges({ onEntity: (entity) => { if (entity === 'roster') void loadSwaps() } })
</script>

<template>
  <div class="a-page">
    <UiPageHead eyebrow="Ljudi" title="Raspored" sub="Sedmica po smjenama" />

    <!-- `ClientOnly`: the business date is resolved from the venue's settings,
         which only exist once the client-only session envelope has loaded. -->
    <ClientOnly>
      <NuxtLink v-if="pendingSwaps > 0" to="/admin/raspored/zamjene" class="r-swaps">
        <span class="r-swaps-n">{{ pendingSwaps }}</span>
        <span class="r-swaps-text">
          {{ pendingSwaps === 1 ? 'zahtjev za zamjenu čeka odgovor' : 'zahtjeva za zamjenu čeka odgovor' }}
        </span>
        <UiIcon name="chevron-right" :size="18" />
      </NuxtLink>

      <RasporedWeekTab :today="today" />
    </ClientOnly>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

/* A wide table scrolls inside its own box; the page body never does. */
.a-page :deep(.a-table-wrap) { contain: paint; }

/**
 * The one row that is allowed back onto this screen, and only when it has
 * something to say. Amber rather than copper: it is the same state the week's
 * own chips use for a pending swap, so the strip and the chip it will take you
 * to are visibly the same fact.
 */
.r-swaps {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: var(--tap);
  padding: 0 14px;
  border-radius: var(--radius-field);
  background: var(--warn-soft);
  color: var(--ink);
  text-decoration: none;
}

.r-swaps-n {
  min-width: 24px;
  height: 24px;
  padding: 0 6px;
  border-radius: 12px;
  background: var(--warn);
  color: var(--on-accent);
  font-size: var(--text-caption);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.r-swaps-text { flex-grow: 1; min-width: 0; font-size: var(--text-label); font-weight: 500; }

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
