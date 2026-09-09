<script setup lang="ts">
/**
 * The feed: newest first, one card per business day.
 *
 * **A business day, not a calendar day.** A round rung up at 02:30 belongs to
 * the night before, and the server has already decided that — `business_date`
 * on every entry is the café's own day. So the grouping here is a plain string
 * comparison and nothing calls `getDate()` on an instant, which would put the
 * end of a night under the wrong heading on the one screen where the owner is
 * reading a night from beginning to end.
 */
import type { LogEntryDetail } from '#shared/types'

const props = defineProps<{
  entries: LogEntryDetail[]
  loading?: boolean
  /** There is another page behind the keyset cursor. */
  more?: boolean
  loadingMore?: boolean
}>()

const emit = defineEmits<{ more: [] }>()

interface Day {
  date: string
  entries: LogEntryDetail[]
}

const days = computed<Day[]>(() => {
  const out: Day[] = []
  for (const entry of props.entries) {
    const last = out[out.length - 1]
    if (last && last.date === entry.business_date) last.entries.push(entry)
    else out.push({ date: entry.business_date, entries: [entry] })
  }
  return out
})

const WEEKDAYS = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub']

/**
 * `"2026-09-11"` → `"pet 11.09.2026."`.
 *
 * The date is *already* the café's business day, so this is calendar
 * arithmetic on a plain `YYYY-MM-DD` and not a timezone conversion — `Date.UTC`
 * with `getUTCDay()` reads the same weekday on a laptop left on UK time.
 */
function dayTitle(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return dateBs(date)
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${dateBs(date)}`
}

/**
 * Infinite scroll on the **keyset** cursor.
 *
 * A keyset cursor names the last row the owner actually saw, so an entry
 * written while he is scrolling cannot shift the page under him the way an
 * `OFFSET` would — he would read one line twice and skip another. The sentinel
 * below is watched by `useIntersectionObserver`; the button under it is the
 * same action for a keyboard and for a browser that never fires the observer.
 */
const sentinel = ref<HTMLElement | null>(null)

useIntersectionObserver(sentinel, ([entry]) => {
  if (entry?.isIntersecting && props.more && !props.loadingMore) emit('more')
})
</script>

<template>
  <div class="d-feed">
    <UiCard v-if="loading">
      <p v-for="n in 4" :key="n" class="d-skeleton" />
    </UiCard>

    <UiCard v-else-if="days.length === 0">
      <p class="d-empty">
        Za ovaj period i ove filtere nema unosa u dnevniku.
      </p>
    </UiCard>

    <UiCard v-for="day in days" :key="day.date" :title="dayTitle(day.date)" :count="day.entries.length">
      <div>
        <DnevnikEntry v-for="entry in day.entries" :key="entry.id" :entry="entry" linked />
      </div>
    </UiCard>

    <div ref="sentinel" class="d-more">
      <UiButton v-if="more" variant="soft" :pending="loadingMore" @click="emit('more')">
        Učitaj još
      </UiButton>
      <p v-else-if="days.length > 0" class="d-end">To je sve za ovaj period.</p>
    </div>
  </div>
</template>

<style scoped>
.d-feed { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

/* A skeleton, not a spinner over stale numbers (§4, "loading states"). */
.d-skeleton {
  height: 20px;
  margin: 0;
  border-radius: 6px;
  background: var(--surface-2);
}

.d-empty, .d-end { margin: 0; color: var(--muted); }

.d-more {
  display: flex;
  justify-content: center;
  padding: 4px 0 8px;
}
</style>
