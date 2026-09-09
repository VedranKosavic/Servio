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
    return a.name.localeCompare(b.name, 'bs')
  })
  if (!needle) return list
  return list.filter(item => fold(item.name).includes(needle))
})
</script>

<template>
  <section class="flex flex-col gap-3">
    <h2 class="text-lg font-semibold">
      Šta se otpisuje
    </h2>

    <input
      v-model="query"
      class="min-h-13 rounded-xl border border-line bg-surface-2 px-3 text-base outline-none"
      placeholder="Traži robu"
      autocomplete="off"
      aria-label="Traži robu"
    >

    <div class="flex flex-col gap-2">
      <button
        v-for="item in shown"
        :key="item.id"
        type="button"
        class="flex min-h-13 items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left"
        :class="selectedId === item.id
          ? 'border-accent bg-accent text-accent-ink'
          : 'border-line bg-surface'"
        @click="$emit('select', item)"
      >
        <span class="text-[17px]">{{ item.name }}</span>
        <span
          class="num shrink-0 text-sm"
          :class="selectedId === item.id ? 'text-accent-ink' : 'text-text-2'"
        >{{ item.base_unit }}</span>
      </button>

      <p v-if="shown.length === 0" class="card px-4 py-6 text-center text-text-2">
        Nema takve robe.
      </p>
    </div>
  </section>
</template>
