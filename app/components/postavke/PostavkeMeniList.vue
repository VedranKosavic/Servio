<script setup lang="ts">
/**
 * *Meni* as a list, for the phone.
 *
 * The laptop draws one `UiCard` + `UiTable` per category. That is right at a
 * desk and wrong in a hand: seven columns in a 390 px box is a sideways drag,
 * and the card heading that says which category is being edited scrolls away
 * after four products.
 *
 * So here a category is **a sticky label over a card of rows**. The label is
 * the page's own ground rather than a card of its own, it holds the top of the
 * screen for as long as its own products are on it, and the next one pushes it
 * off — which means the owner always knows which group the price he is typing
 * belongs to. Nothing scrolls sideways, because nothing is wider than the
 * screen.
 */
import type { CategoryAdmin, ProductAdmin } from '#shared/types'
import type { UpdateProductBody } from '#shared/schemas'

defineProps<{
  /** Categories that still have a visible product, in the menu's own order. */
  groups: Array<{ category: CategoryAdmin, rows: ProductAdmin[] }>
  /** The first read has not landed: draw bars, not an empty screen. */
  loading: boolean
  /** Which product has a write in flight. */
  busyId: string | null
}>()

const emit = defineEmits<{
  patch: [product: ProductAdmin, patch: UpdateProductBody]
  open: [product: ProductAdmin]
}>()
</script>

<template>
  <div class="p-list">
    <div v-if="loading" class="p-card p-skel" aria-hidden="true">
      <div v-for="n in 4" :key="n" class="p-skel-row">
        <span class="p-skel-bar wide" />
        <span class="p-skel-bar" />
      </div>
    </div>

    <section v-for="group in groups" :key="group.category.id" class="p-group">
      <h2 class="p-group-head">
        <span class="p-group-name">{{ group.category.name }}</span>
        <span class="p-group-n num">{{ group.rows.length }}</span>
      </h2>

      <div class="p-card">
        <PostavkeMeniRow
          v-for="product in group.rows"
          :key="product.id"
          :product="product"
          :pending="busyId === product.id"
          @patch="body => emit('patch', product, body)"
          @open="emit('open', product)"
        />
      </div>
    </section>

    <p v-if="!loading && groups.length === 0" class="p-empty">
      Nema artikala po ovoj pretrazi.
    </p>
  </div>
</template>

<style scoped>
.p-list { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

.p-group { display: flex; flex-direction: column; gap: 6px; min-width: 0; }

/**
 * The one sticky thing on the screen.
 *
 * It sits on `--bg` — the page's own ground, opaque — so the card of rows
 * passes cleanly underneath it, and it is only as wide as the card, so nothing
 * shows around its edges. `top: 0` is the top of the viewport: the dashboard's
 * phone layout puts its tab bar at the **bottom**, so there is nothing up there
 * to sit under.
 */
.p-group-head {
  position: sticky;
  top: 0;
  z-index: 2;
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 10px 2px 7px;
  background: var(--bg);
  font-size: var(--text-section);
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--ink);
}

.p-group-n { font-size: var(--text-label); font-weight: 500; color: var(--muted); }

.p-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  overflow: hidden;
  min-width: 0;
}

/* Bars, not a spinner over stale numbers — the same shape `UiTable` draws. */
.p-skel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 16px;
  border-bottom: 1px solid var(--line-soft);
}

.p-skel-row:last-child { border-bottom: 0; }

.p-skel-bar {
  display: block;
  height: 10px;
  width: 72px;
  border-radius: var(--radius-chip);
  background: var(--surface-2);
}

.p-skel-bar.wide { width: 45%; }

.p-empty {
  margin: 0;
  padding: 22px 16px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-card);
  color: var(--muted);
  font-size: var(--text-body);
  text-align: center;
}
</style>
