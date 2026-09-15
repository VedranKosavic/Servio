<script setup lang="ts">
/**
 * Step one of *Otpis*: which article from the menu was spilled or broken.
 *
 * The owner's call: an otpis is written against the **menu**, and valued at the
 * menu price. So this lists what *Dodaj* lists — the active products — grouped
 * under their categories in menu order, with the same search box and the same
 * matcher (`matchesQuery`: prefix, diacritics folded, aliases included), so
 * "cola" finds *Coca-Cola* here exactly as it does on the order screen.
 *
 * One tap picks. *Ostalo* is left out: it is a price with no name, and an otpis
 * of "something, 5 KM" tells the owner nothing.
 */
import { formatKm } from '#shared/money'
import type { Category, Product } from '#shared/types'
import { matchesQuery } from '~/components/order/OrderText'

const props = defineProps<{ products: Product[], categories: Category[] }>()
defineEmits<{ select: [Product] }>()

const query = ref('')

const groups = computed(() => {
  const list = props.products.filter(p => p.system_key !== 'ostalo')
  const needle = query.value.trim()
  const shown = needle ? list.filter(p => matchesQuery(p, needle)) : list
  return props.categories
    .map(category => ({
      id: category.id,
      name: category.name,
      items: shown.filter(p => p.category_id === category.id),
    }))
    .filter(group => group.items.length > 0)
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
      placeholder="Traži po meniju"
      autocomplete="off"
      inputmode="search"
      aria-label="Traži po meniju"
    >

    <template v-if="groups.length">
      <div v-for="group in groups" :key="group.id" class="flex flex-col gap-1.5">
        <h3 class="text-label text-text-2">
          {{ group.name }}
        </h3>
        <!-- One card per category, rows inside it: a list, not a spreadsheet. -->
        <div class="card px-4">
          <button
            v-for="product in group.items"
            :key="product.id"
            type="button"
            class="row w-full gap-3"
            @click="$emit('select', product)"
          >
            <span class="grow text-left text-body">{{ product.name }}</span>
            <span class="num shrink-0 text-label text-muted">{{ formatKm(product.price_fen) }}</span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-muted" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>
    </template>

    <p v-else class="empty">
      Ništa ne odgovara traženom.
    </p>
  </section>
</template>
