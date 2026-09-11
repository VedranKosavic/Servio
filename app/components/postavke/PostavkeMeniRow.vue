<script setup lang="ts">
/**
 * One product on *Meni*, the way a phone draws it.
 *
 * The laptop gets a seven-column table (`PostavkeProductRow`). On a 390 px
 * screen that table is a box the owner drags sideways: he sees the name, a
 * price field and the ghost of a third column, and the four controls that
 * matter are off the right edge. So below 1024 px the row stops being a table
 * row and becomes what it actually is — **a name, the price, and a way in.**
 *
 * The price is the one thing on this screen that is edited weekly, so it stays
 * on the row and is one tap away; it commits on blur exactly as it does on the
 * laptop. Everything set once a season — *Omiljeno*, *Aktivan*, *Osoblje*,
 * *g / lula*, *Normativ* — is behind the chevron, in
 * `PostavkeMeniSheet`.
 *
 * **The row carries no badges.** It briefly wore a star for *omiljeno*, pills
 * for *osoblje* and *bez normativa* and the grams of a nargila, and six rows of
 * that is a wall of decoration around the one number the owner came to change.
 * Every one of those settings still exists and still lives one tap away in
 * `PostavkeMeniSheet`, which is also where a product is judged — a list is for
 * finding a price, not for auditing a catalogue.
 *
 * The single exception is *ugašen*, and it is not decoration: under the *Svi*
 * filter a switched-off product is otherwise identical to a live one, and
 * mistaking the two is how a price gets corrected on an item no waiter can
 * sell. It never appears under *Aktivni*, which is the default.
 */
import type { ProductAdmin } from '#shared/types'
import type { UpdateProductBody } from '#shared/schemas'

const props = defineProps<{
  product: ProductAdmin
  /** A write for this row is in flight; its own price field greys out. */
  pending: boolean
}>()

const emit = defineEmits<{
  patch: [patch: UpdateProductBody]
  /** Open the sheet with the rest of this product's settings. */
  open: []
}>()

</script>

<template>
  <div class="p-row" :class="{ inactive: !product.active }">
    <div class="p-text">
      <p class="p-name">{{ product.name }}</p>
      <p v-if="!product.active" class="p-meta">
        <UiPill tone="bad">ugašen</UiPill>
      </p>
    </div>

    <PostavkeNum
      :model-value="product.price_fen"
      kind="money"
      :label="`Cijena, ${product.name}`"
      suffix="KM"
      width="118px"
      :pending="pending"
      @commit="value => value !== null && emit('patch', { price_fen: value })"
    />

    <button
      type="button"
      class="p-open"
      :aria-label="`Postavke, ${product.name}`"
      @click="emit('open')"
    ><UiIcon name="chevron-right" :size="20" /></button>
  </div>
</template>

<style scoped>
.p-row {
  display: grid;
  /* name · price · the way in. The name takes what is left and wraps rather
     than truncating: on this screen the name is how the owner knows which
     price he is about to change. */
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 4px 10px;
  /* A name-and-price row wants more air than a name-price-and-two-badges one
     did: 12 px top and bottom puts the row at 56 px, the same rhythm as
     *Osoblje* and the *Ostalo* list. */
  padding: 12px 6px 12px 16px;
  border-bottom: 1px solid var(--line-soft);
}

.p-row:last-child { border-bottom: 0; }

/* Off the menu: the row is still readable and still editable, just quieter —
   and the *ugašen* pill says it in a word as well, because opacity alone is a
   difference somebody scrolling does not see. */
.p-row.inactive .p-text { opacity: 0.6; }

.p-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }

.p-name {
  margin: 0;
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--ink);
  line-height: 1.3;
}


.p-meta {
  margin: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 6px;
  min-width: 0;
}


.p-open {
  width: var(--tap);
  height: var(--tap);
  border: 0;
  background: transparent;
  color: var(--muted);
  border-radius: var(--radius-field);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}

.p-open:hover { background: var(--surface-2); color: var(--ink); }
.p-open:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

</style>
