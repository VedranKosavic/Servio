<script setup lang="ts">
/**
 * One product on *Meni*: the price the guest pays, whether it is on the phone's
 * *Omiljeno* tab, whether it is still sold, whether staff may drink it, and the
 * way into its *normativ*.
 *
 * Everything here saves **on its own**, the moment it changes — there is no Save
 * button on this page, because a menu is edited one price at a time and a form
 * that has to be submitted is a form somebody leaves half-typed. The price field
 * commits on blur; the switches commit on the click.
 *
 * It renders a `<tr>`, so it is used inside `UiTable`'s row slot.
 */
import type { ProductAdmin } from '#shared/types'
import type { UpdateProductBody } from '#shared/schemas'

const props = defineProps<{
  product: ProductAdmin
  /** Twelve favourites are already taken and this one is not one of them. */
  favouriteFull: boolean
  /** A write for this row is in flight. */
  pending: boolean
}>()

const emit = defineEmits<{
  patch: [patch: UpdateProductBody]
  recipe: []
}>()

/** A product with no recipe and no 1:1 shelf item consumes nothing on a sale. */
const noRecipe = computed(() =>
  props.product.recipe.length === 0 && !props.product.sells_stock_item_id)

const isShisha = computed(() => props.product.kind === 'shisha')

const starDisabled = computed(() => props.favouriteFull && !props.product.is_favourite)
</script>

<template>
  <tr :class="{ inactive: !product.active }">
    <td>
      <div class="p-name">
        <strong>{{ product.name }}</strong>
        <small v-if="product.short_name">{{ product.short_name }}</small>
      </div>
      <UiPill v-if="noRecipe" tone="warn">bez normativa</UiPill>
    </td>

    <td class="r">
      <PostavkeNum
        :model-value="product.price_fen"
        kind="money"
        :label="`Cijena, ${product.name}`"
        suffix="KM"
        width="120px"
        :pending="pending"
        @commit="value => value !== null && emit('patch', { price_fen: value })"
      />
      <div v-if="product.price_since" class="p-since">od {{ dateBs(product.price_since) }}</div>
    </td>

    <td class="r">
      <template v-if="isShisha">
        <PostavkeNum
          :model-value="product.shisha_grams"
          kind="decimal"
          :label="`Grama po luli, ${product.name}`"
          suffix="g"
          width="94px"
          :pending="pending"
          @commit="value => emit('patch', { shisha_grams: value })"
        />
        <div class="p-since">
          <UiPill v-if="product.shisha_grams_measured_at" tone="good">izmjereno</UiPill>
          <span v-else>procijenjeno</span>
        </div>
      </template>
      <span v-else class="p-dash">—</span>
    </td>

    <td>
      <!-- The kit has no star; this one is drawn on the same 24 px stroke grid
           as `UiIcon`, and it is a shape change as well as a colour change so
           the state is readable without colour. -->
      <button
        type="button"
        class="p-star"
        :class="{ on: product.is_favourite }"
        :aria-pressed="product.is_favourite"
        :aria-label="`Omiljeno, ${product.name}`"
        :title="starDisabled ? 'Već je 12 omiljenih artikala' : 'Omiljeno'"
        :disabled="starDisabled || pending"
        @click="emit('patch', { is_favourite: !product.is_favourite })"
      >
        <svg
          width="22" height="22" viewBox="0 0 24 24"
          :fill="product.is_favourite ? 'currentColor' : 'none'"
          stroke="currentColor" stroke-width="1.8"
          stroke-linecap="round" stroke-linejoin="round"
        ><path d="M12 4l2.4 5 5.6.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.6-.8z" /></svg>
      </button>
    </td>

    <td>
      <PostavkeToggle
        :model-value="product.active"
        :label="`Aktivan, ${product.name}`"
        :disabled="pending"
        @update:model-value="value => emit('patch', { active: value })"
      />
    </td>

    <td>
      <PostavkeToggle
        :model-value="product.staff_drink_allowed"
        :label="`Piće za osoblje, ${product.name}`"
        :disabled="pending"
        @update:model-value="value => emit('patch', { staff_drink_allowed: value })"
      />
    </td>

    <td class="r">
      <UiButton small variant="ghost" @click="emit('recipe')">
        Normativ
        <UiIcon name="chevron-right" :size="18" />
      </UiButton>
    </td>
  </tr>
</template>

<style scoped>
.inactive td { opacity: 0.55; }

.p-name { display: flex; flex-direction: column; gap: 1px; min-width: 140px; }
.p-name small { color: var(--muted); font-size: var(--text-caption); }

.p-since {
  font-size: var(--text-caption);
  color: var(--muted);
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
}

.p-dash { color: var(--muted); }

.p-star {
  width: 44px;
  height: 44px;
  border: 0;
  background: transparent;
  border-radius: 10px;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.p-star.on { color: var(--accent); }
.p-star:disabled { cursor: default; opacity: 0.4; }
.p-star:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
</style>
