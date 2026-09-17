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
import type { ProductAdmin, StockItemAdmin } from '#shared/types'
import type { UpdateProductBody } from '#shared/schemas'
import { zalihaSummary } from '~/utils/menuZaliha'

const props = defineProps<{
  open: boolean
  product: ProductAdmin | null
  /** *Stanje šanka*, to name what this article takes off it. */
  items: StockItemAdmin[]
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
  /** Hand over to `PostavkeZalihaSheet`; the page closes this sheet first. */
  zaliha: []
  /** Ask to take this product off the menu; the page closes this sheet and confirms. */
  remove: []
}>()

const starDisabled = computed(() =>
  props.favouriteFull && !props.product?.is_favourite)

/** What the *Stanje šanka* row says about itself before it is opened. */
const zalihaLine = computed(() =>
  props.product ? zalihaSummary(props.product, props.items) : '')
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

        <div class="p-set">
          <span class="p-set-text">
            <span class="p-set-label">Dostupno do</span>
            <span class="p-set-hint">
              {{ product.available_until
                ? `Poslije ${product.available_until} konobar ga ne može dodati na sto.`
                : 'Cijeli dan. Upiši sat za npr. Happy Hour.' }}
            </span>
          </span>
          <PostavkeDostupnoDo
            :model-value="product.available_until"
            :label="`Dostupno do, ${product.name}`"
            :disabled="pending"
            @update:model-value="value => emit('patch', { available_until: value })"
          />
        </div>

        <div class="p-set">
          <span class="p-set-text">
            <span class="p-set-label">Stanje šanka</span>
            <span class="p-set-hint">{{ zalihaLine }}</span>
          </span>
          <UiButton small variant="ghost" @click="emit('zaliha')">
            Uredi
            <UiIcon name="chevron-right" :size="18" />
          </UiButton>
        </div>
      </div>
    </template>

    <template #footer>
      <!-- Removing is switching off, never deleting: past rounds point at this
           product. The page asks before it does it. -->
      <UiButton
        v-if="product"
        variant="danger"
        :disabled="pending"
        @click="emit('remove')"
      >Ukloni s menija</UiButton>
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
