<script setup lang="ts">
/**
 * Everything about one product that is **not** its price.
 *
 * On a laptop these are four columns of a table and they are fine there: the
 * owner sees fourteen products' *Omiljeno* at once and can compare them. On a
 * phone the same four columns are off the right edge behind a horizontal
 * scrollbar, which is the same as not existing. So below 1024 px they live
 * here, one per line, each with the sentence that says what it does — which the
 * table has never had room for.
 *
 * Nothing in this sheet is submitted: every switch writes the moment it is
 * touched, exactly as the table's do, and the sheet has no Save button for the
 * same reason the page has none. *Gotovo* closes it and nothing else.
 *
 * `product` is looked up fresh by the page on every render, so a write landing
 * while the sheet is open moves the switch under it rather than leaving a state
 * the database does not have.
 */
import type { ProductAdmin } from '#shared/types'
import type { UpdateProductBody } from '#shared/schemas'

const props = defineProps<{
  open: boolean
  product: ProductAdmin | null
  /** The favourite tab is full and this product is not on it. */
  favouriteFull: boolean
  /** How many favourites the waiter's tab holds — 12. */
  favouriteCap: number
  /** A write for this product is in flight. */
  pending: boolean
}>()

const emit = defineEmits<{
  close: []
  patch: [patch: UpdateProductBody]
  /** Hand over to `PostavkeRecipeEditor`; the page closes this sheet first. */
  recipe: []
}>()

const isShisha = computed(() => props.product?.kind === 'shisha')

const starDisabled = computed(() =>
  props.favouriteFull && !props.product?.is_favourite)

/** What the *Normativ* row says about itself before it is opened. */
const recipeLine = computed(() => {
  const product = props.product
  if (!product) return ''
  if (product.sells_stock_item_id) return 'Vezano direktno za robu.'
  const count = product.recipe.length
  if (count === 0) return 'Prodaja ne skida robu.'
  if (count === 1) return '1 stavka'
  if (count < 5) return `${count} stavke`
  return `${count} stavki`
})
</script>

<template>
  <UiSheet
    :open="open"
    :title="product?.name ?? 'Artikal'"
    @close="emit('close')"
  >
    <template v-if="product">
      <p class="p-sum">
        {{ product.category_name }} ·
        <span class="num">{{ formatKm(product.price_fen) }}</span>
        <template v-if="product.price_since"> · od
          <span class="num">{{ dateBs(product.price_since) }}</span>
        </template>
      </p>

      <div class="p-sets">
        <div class="p-set">
          <span class="p-set-text">
            <span class="p-set-label">Omiljeno</span>
            <span class="p-set-hint">
              {{ starDisabled
                ? `Već je ${favouriteCap} omiljenih artikala.`
                : 'Stoji na tabu Omiljeno kod konobara.' }}
            </span>
          </span>
          <PostavkeToggle
            :model-value="product.is_favourite"
            :label="`Omiljeno, ${product.name}`"
            :disabled="starDisabled || pending"
            words
            @update:model-value="value => emit('patch', { is_favourite: value })"
          />
        </div>

        <div class="p-set">
          <span class="p-set-text">
            <span class="p-set-label">Aktivan</span>
            <span class="p-set-hint">Ugašen artikal se ne nudi na telefonu.</span>
          </span>
          <PostavkeToggle
            :model-value="product.active"
            :label="`Aktivan, ${product.name}`"
            :disabled="pending"
            words
            @update:model-value="value => emit('patch', { active: value })"
          />
        </div>

        <div class="p-set">
          <span class="p-set-text">
            <span class="p-set-label">Piće za osoblje</span>
            <span class="p-set-hint">Konobar ga može uzeti kao svoje piće.</span>
          </span>
          <PostavkeToggle
            :model-value="product.staff_drink_allowed"
            :label="`Piće za osoblje, ${product.name}`"
            :disabled="pending"
            words
            @update:model-value="value => emit('patch', { staff_drink_allowed: value })"
          />
        </div>

        <div v-if="isShisha" class="p-set">
          <span class="p-set-text">
            <span class="p-set-label">Grama po luli</span>
            <span class="p-set-hint">
              <UiPill v-if="product.shisha_grams_measured_at" tone="good">izmjereno</UiPill>
              <template v-else>Procijenjeno — izmjeri lulu na vagi.</template>
            </span>
          </span>
          <PostavkeNum
            :model-value="product.shisha_grams"
            kind="decimal"
            :label="`Grama po luli, ${product.name}`"
            suffix="g"
            width="104px"
            :pending="pending"
            @commit="value => emit('patch', { shisha_grams: value })"
          />
        </div>

        <div class="p-set">
          <span class="p-set-text">
            <span class="p-set-label">
              Normativ
            </span>
            <span class="p-set-hint">{{ recipeLine }}</span>
          </span>
          <UiButton small variant="ghost" @click="emit('recipe')">
            Uredi
            <UiIcon name="chevron-right" :size="18" />
          </UiButton>
        </div>
      </div>
    </template>

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Gotovo</UiButton>
    </template>
  </UiSheet>
</template>

<style scoped>
.p-sum {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-micro);
}

/* One list, one rule between lines — the sheet body's own gap would put air
   between rows that are meant to read as one block. */
.p-sets { display: flex; flex-direction: column; }

.p-set {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: var(--tap);
  padding: 10px 0;
  border-bottom: 1px solid var(--line-soft);
}

.p-set:last-child { border-bottom: 0; }

.p-set-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex-grow: 1; }

.p-set-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--ink);
}

.p-set-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-micro);
  color: var(--muted);
}
</style>
