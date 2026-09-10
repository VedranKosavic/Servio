<script setup lang="ts">
/**
 * Step one of *Otpis*: which item broke.
 *
 * The list is everything on the shelf, newest concern first — the spot items
 * (bottles, tins, coal) sit at the top because they are what actually gets
 * dropped, and the search is there for the twentieth item nobody scrolls to.
 *
 * Diacritics are folded before matching: a phone keyboard in a hurry types
 * "secer", and *Šećer* should still come up.
 */
import { bsCompare } from '#shared/collate'
import type { StockItem } from '#shared/types'

const props = defineProps<{ items: StockItem[], selectedId: string | null }>()
defineEmits<{ select: [StockItem] }>()

const query = ref('')

/** "Šećer" → "secer": one comparable shape for both sides of the match. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd').toLowerCase()
}

const shown = computed(() => {
  const needle = fold(query.value.trim())
  const list = [...props.items].sort((a, b) => {
    if (a.is_spot !== b.is_spot) return a.is_spot ? -1 : 1
    return bsCompare(a.name, b.name)
  })
  if (!needle) return list
  return list.filter(item => fold(item.name).includes(needle))
})
</script>

<template>
  <section class="flex flex-col gap-3">
    <h2 class="section-title">
      Šta se otpisuje
    </h2>

    <input
      v-model="query"
      class="input"
      placeholder="Traži robu"
      autocomplete="off"
      aria-label="Traži robu"
    >

    <!-- One card, rows inside it. Twenty items each boxed in its own card is a
         spreadsheet; a list of rules under a single edge is a list. -->
    <div v-if="shown.length" class="card px-4">
      <button
        v-for="item in shown"
        :key="item.id"
        type="button"
        class="row w-full gap-3"
        :class="selectedId === item.id ? 'text-accent-text' : ''"
        @click="$emit('select', item)"
      >
        <span class="grow text-body" :class="selectedId === item.id ? 'font-semibold' : ''">{{ item.name }}</span>
        <span class="num shrink-0 text-label text-muted">{{ item.base_unit }}</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-muted" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
    </div>

    <p v-else class="empty">
      Nema takve robe.
    </p>
  </section>
</template>
