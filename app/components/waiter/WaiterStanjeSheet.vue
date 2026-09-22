<script setup lang="ts">
/**
 * *Stanje šanka*, over the floor plan.
 *
 * The shelf has a screen of its own — `/stanje`, the bartender's — and sending
 * a waiter there means dropping him into the other app's shell, with the other
 * app's tabs along the bottom and no way back to his room. He asked for the
 * shelf **from the bar**, so the shelf comes to him: the same read
 * (`GET /api/stock`, which workers may make), grouped by the same categories,
 * drawn by the same `StockGroup` rows, and closed with a tap on the scrim.
 *
 * Read-only, on purpose. *Prijem robe* is the admin's and the bartender's;
 * nothing here writes.
 */
import type { StockItem } from '#shared/types'

const emit = defineEmits<{ close: [] }>()

useSheetDismiss(() => emit('close'))

const api = useApi()
const me = useMe()

const items = ref<StockItem[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const query = ref('')

onMounted(async () => {
  try {
    items.value = (await api.getStock()).items
    error.value = null
  } catch (err) {
    error.value = apiErrorText(err, 'Stanje se nije učitalo.')
    void me.handleAuthError(err)
  } finally {
    loading.value = false
  }
})

/** 65 articles is a lot of thumb: a name filter is the fastest way to one. */
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q ? items.value.filter(item => item.name.toLowerCase().includes(q)) : items.value
})

/** The bartender screen's own grouping: by category, in the owner's order. */
const groups = computed(() => {
  const byKey = new Map<string, { key: string, title: string, sort: number, items: StockItem[] }>()
  for (const item of shown.value) {
    const key = item.category_id ?? 'bez-kategorije'
    let group = byKey.get(key)
    if (!group) {
      group = {
        key,
        title: item.category_name ?? 'Bez kategorije',
        sort: item.category_id ? item.category_sort ?? 0 : Number.MAX_SAFE_INTEGER,
        items: [],
      }
      byKey.set(key, group)
    }
    group.items.push(item)
  }
  return [...byKey.values()].sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title, 'bs'))
})
</script>

<template>
  <div class="fixed inset-0 z-50">
    <div class="sheet-scrim" @click="emit('close')" />

    <div
      class="sheet-panel absolute inset-x-0 bottom-0 mx-auto flex max-h-[92dvh] min-h-[70dvh] w-full max-w-3xl flex-col gap-4 overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3"
      role="dialog"
      aria-label="Stanje šanka"
    >
      <span class="mx-auto h-1 w-10 shrink-0 rounded-full bg-line" />

      <div class="flex items-center gap-3">
        <button
          type="button"
          class="flex size-11 shrink-0 items-center justify-center rounded-control bg-surface-2 text-text-2"
          aria-label="Zatvori"
          @click="emit('close')"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <span class="section-title grow truncate">Stanje šanka</span>
      </div>

      <input
        v-model="query"
        type="search"
        class="input"
        placeholder="Traži artikal"
        aria-label="Traži artikal"
        enterkeyhint="search"
      >

      <p v-if="error" class="note note-warn" role="alert">{{ error }}</p>

      <p v-else-if="loading" class="py-6 text-center text-text-2">Učitavanje…</p>

      <div v-else-if="groups.length" class="flex flex-col gap-5">
        <StockGroup
          v-for="group in groups"
          :key="group.key"
          :title="group.title"
          :items="group.items"
        />
      </div>

      <p v-else class="py-6 text-center text-text-2">
        {{ items.length ? 'Nema artikla s tim imenom.' : 'Nema artikala na stanju.' }}
      </p>

      <p class="pb-1 text-center text-caption tracking-normal text-muted">
        Svaka zaključana tura oduzima od stanja, prijem robe dodaje.
      </p>
    </div>
  </div>
</template>
