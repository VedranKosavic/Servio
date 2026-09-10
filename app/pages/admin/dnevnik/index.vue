<script setup lang="ts">
/**
 * *Dnevnik* — ko je šta uradio.
 *
 * **Owner-only, and that is a product rule.** Nothing on this page ever appears
 * in `/konobar`: the server declares `GET /api/owner/log` as `admin` and
 * `requireRole` enforces it a second time. It is the same rule that keeps the
 * *Konobari* channel out of the owner's app, pointed the other way.
 *
 * Three things worth knowing about how it reads:
 *
 * - **One poll.** The page opens no timer of its own. `useAdminChanges` is the
 *   dashboard's single 15 s feed, and this screen refetches only when the `log`
 *   entity moves — and only while the owner is still on the first page, so a
 *   new entry cannot yank the list out from under somebody who is scrolling.
 * - **A keyset cursor, never an offset.** `next_cursor` names the last row he
 *   actually saw. An offset would re-skip rows that a new entry keeps shifting.
 * - **Opening the page clears the badge.** `POST /api/owner/log/seen` stamps
 *   `users.log_seen_at` on the server so his other device agrees, and
 *   `changes.markLogSeen()` clears the dot in this tab immediately.
 */
import type { LogEntryDetail, LogKind, LogQuery, UserAdmin } from '#shared/types'

definePageMeta({
  layout: 'admin',
  middleware: [
    'admin',
    /**
     * The Dnevnik opens on **this week**, not on today.
     *
     * At 09:00 the café's business day has only just started and holds nothing;
     * what the owner came to read is last night, which is yesterday's business
     * date. The preset is written into the query here, before the page is
     * created, rather than defaulted in the component — because `UiPeriod`
     * reads the same query, and a component that defaulted privately would
     * highlight *Danas* while the feed showed a week.
     */
    (to) => {
      if (to.query.period || to.query.from || to.query.to) return
      return navigateTo(
        { path: to.path, query: { ...to.query, period: 'ova-sedmica' } },
        { replace: true },
      )
    },
  ],
})

useHead({ title: 'Dnevnik' })

const api = useAdminApi()
const route = useRoute()
const router = useRouter()
const period = useAdminPeriod()

const entries = ref<LogEntryDetail[]>([])
const cursor = ref<string | undefined>()
const users = ref<UserAdmin[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const error = ref('')
/** How many pages deep the owner has scrolled; the poll only refreshes page 1. */
const pages = ref(1)

// --- the filters, all of them in the route query ---------------------------

const important = computed(() => route.query.vazno !== '0')
const actor = computed(() => String(route.query.osoba ?? ''))
const kind = computed(() => String(route.query.vrsta ?? ''))

function setQuery(patch: Record<string, string | undefined>) {
  const query = { ...route.query, ...patch }
  for (const [key, value] of Object.entries(patch)) if (!value) delete query[key]
  // `replace`, so the back button leaves the page instead of the last filter.
  void router.replace({ query })
}

const query = computed<LogQuery>(() => ({
  from: period.range.value.from,
  to: period.range.value.to,
  ...(actor.value ? { actor: actor.value } : {}),
  ...(kind.value ? { kind: kind.value as LogKind } : {}),
  ...(important.value ? { important: true } : {}),
}))

// --- reads ------------------------------------------------------------------

async function load() {
  // Client-only: the session is a httpOnly cookie the browser holds, and a
  // server-rendered `$fetch` would carry none of it and answer 401.
  if (!import.meta.client) return
  loading.value = true
  error.value = ''
  try {
    const result = await api.getOwnerLog(query.value)
    entries.value = result.entries
    cursor.value = result.next_cursor
    pages.value = 1
  } catch (err) {
    error.value = apiErrorText(err, 'Dnevnik se nije učitao.')
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (!cursor.value || loadingMore.value) return
  loadingMore.value = true
  try {
    const result = await api.getOwnerLog({ ...query.value, before: cursor.value })
    entries.value = [...entries.value, ...result.entries]
    cursor.value = result.next_cursor
    pages.value += 1
  } catch (err) {
    error.value = apiErrorText(err, 'Sljedeća stranica se nije učitala.')
  } finally {
    loadingMore.value = false
  }
}

const changes = useAdminChanges({
  onEntity: (entity) => {
    // Only `log` matters here, and only while he is still at the top: a
    // refetch under a scrolled list would move the row he is reading.
    if (entity === 'log' && pages.value === 1) void load()
  },
})

onMounted(async () => {
  try {
    users.value = await api.getUsers()
  } catch {
    // The *Osoba* dropdown degrades to "Svi" — a missing filter is not a
    // reason to refuse to show the feed.
    users.value = []
  }

  try {
    await api.markLogSeen()
    changes.markLogSeen()
  } catch {
    // The badge is a convenience; a failed stamp must not block the page.
  }
})

watch(query, load, { immediate: true, deep: true })
</script>

<template>
  <div class="a-page">
    <UiPageHead eyebrow="Podešavanje" title="Dnevnik" sub="Ko je šta uradio · samo vlasnici" />

    <DnevnikFilters
      :important="important"
      :actor="actor"
      :kind="kind"
      :users="users"
      @update:important="setQuery({ vazno: $event ? undefined : '0' })"
      @update:actor="setQuery({ osoba: $event })"
      @update:kind="setQuery({ vrsta: $event })"
    />

    <UiCard v-if="error">
      <p class="a-error">{{ error }}</p>
    </UiCard>

    <DnevnikFeed
      :entries="entries"
      :loading="loading"
      :more="Boolean(cursor)"
      :loading-more="loadingMore"
      @more="loadMore"
    />
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }



.a-error { margin: 0; color: var(--danger); }
</style>
