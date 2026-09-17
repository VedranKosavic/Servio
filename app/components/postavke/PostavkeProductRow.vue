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
import type { ProductAdmin, StockItemAdmin } from '#shared/types'
import type { UpdateProductBody } from '#shared/schemas'
import { zalihaSummary } from '~/utils/menuZaliha'

const props = defineProps<{
  product: ProductAdmin
  /** *Stanje šanka*, to name what this article takes off it. */
  items: StockItemAdmin[]
  /** Twelve favourites are already taken and this one is not one of them. */
  favouriteFull: boolean
  /** A write for this row is in flight. */
  pending: boolean
}>()

const emit = defineEmits<{
  patch: [patch: UpdateProductBody]
  /** Open *Oduzima sa stanja* for this article. */
  zaliha: []
  /** Ask to take this product off the menu; the page confirms first. */
  remove: []
}>()

const zalihaLine = computed(() => zalihaSummary(props.product, props.items))

const starDisabled = computed(() => props.favouriteFull && !props.product.is_favourite)
</script>

<template>
  <tr :class="{ inactive: !product.active }">
    <td>
      <div class="p-name">
        <strong>{{ product.name }}</strong>
        <small v-if="product.short_name">{{ product.short_name }}</small>
        <!-- Happy Hour: not orderable after this hour. Empty is all day. -->
        <span class="p-until">
          <small>dostupno do</small>
          <PostavkeDostupnoDo
            :model-value="product.available_until"
            :label="`Dostupno do, ${product.name}`"
            :disabled="pending"
            @update:model-value="value => emit('patch', { available_until: value })"
          />
        </span>
      </div>
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

    <td>
      <button type="button" class="p-zaliha" @click="emit('zaliha')">
        <span>{{ zalihaLine }}</span>
        <UiIcon name="chevron-right" :size="16" />
      </button>
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
      <!-- Removing is switching off: past rounds point at this product, so it
           can never be deleted. The page asks before it does it. -->
      <UiButton
        small
        variant="ghost"
        :disabled="pending"
        :aria-label="`Ukloni s menija, ${product.name}`"
        @click="emit('remove')"
      >Ukloni</UiButton>
    </td>

    <td>
      <PostavkeToggle
        :model-value="product.staff_drink_allowed"
        :label="`Piće za osoblje, ${product.name}`"
        :disabled="pending"
        @update:model-value="value => emit('patch', { staff_drink_allowed: value })"
      />
    </td>

  </tr>
</template>

<style scoped>
.inactive td { opacity: 0.55; }

.p-zaliha {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
  border: 0;
  background: none;
  color: var(--ink-2);
  font: inherit;
  font-size: var(--text-label);
  text-align: left;
  cursor: pointer;
}
.p-zaliha:hover { color: var(--ink); }

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
.p-until { display: inline-flex; align-items: center; gap: 6px; margin-top: 4px; }
.p-until small { color: var(--muted); }
</style>
