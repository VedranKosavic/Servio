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
 * **State is a mark, not a column.** A favourite carries a filled star after
 * its name (a shape change, so it survives being read without colour), and
 * anything else worth knowing at a glance — *ugašen*, *osoblje*, *bez
 * normativa*, the grams of a nargila — is a pill on the second line, which is
 * drawn only when there is something to put on it.
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

/** A product with no recipe and no 1:1 shelf item consumes nothing on a sale. */
const noRecipe = computed(() =>
  props.product.recipe.length === 0 && !props.product.sells_stock_item_id)

const isShisha = computed(() => props.product.kind === 'shisha')

/** `20` → `"20"`, `2.5` → `"2,5"`. Bosnian decimals, never `toFixed`. */
const grams = computed(() => {
  const value = props.product.shisha_grams
  if (!isShisha.value || value === null) return null
  return String(value).replace('.', ',')
})

/** Draw the second line only when it would carry something. */
const hasMeta = computed(() =>
  !!props.product.short_name
  || !props.product.active
  || noRecipe.value
  || props.product.staff_drink_allowed
  || grams.value !== null)
</script>

<template>
  <div class="p-row" :class="{ inactive: !product.active }">
    <div class="p-text">
      <p class="p-name">
        {{ product.name }}
        <span v-if="product.is_favourite" class="p-star">
          <!-- The kit has no star. Same 24 px grid and 1.8 stroke as `UiIcon`,
               filled rather than outlined, so "omiljeno" is a shape and not
               only a colour. -->
          <svg
            width="16" height="16" viewBox="0 0 24 24"
            fill="currentColor" stroke="currentColor" stroke-width="1.8"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
          ><path d="M12 4l2.4 5 5.6.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.6-.8z" /></svg>
          <span class="p-sr">omiljeno</span>
        </span>
      </p>

      <p v-if="hasMeta" class="p-meta">
        <span v-if="product.short_name" class="p-short">{{ product.short_name }}</span>
        <UiPill v-if="!product.active" tone="bad">ugašen</UiPill>
        <UiPill v-if="noRecipe" tone="warn">bez normativa</UiPill>
        <UiPill v-if="product.staff_drink_allowed">osoblje</UiPill>
        <span v-if="grams" class="p-g num">{{ grams }} g / lula</span>
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
  gap: 4px 8px;
  padding: 8px 6px 8px 16px;
  border-bottom: 1px solid var(--line-soft);
}

.p-row:last-child { border-bottom: 0; }

/* Off the menu: the row is still readable and still editable, just quieter —
   and the *ugašen* pill says it in a word as well. */
.p-row.inactive .p-text { opacity: 0.6; }

.p-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }

.p-name {
  margin: 0;
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--ink);
  line-height: 1.3;
}

.p-star {
  display: inline-flex;
  align-items: center;
  color: var(--accent-text);
  margin-left: 5px;
  vertical-align: -2px;
}

.p-meta {
  margin: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 6px;
  min-width: 0;
}

.p-short,
.p-g { font-size: var(--text-micro); color: var(--muted); }

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

/* Read out, never drawn — the star's own word, so the mark is not only a mark. */
.p-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
