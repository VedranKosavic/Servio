<script setup lang="ts">
/**
 * One product on *Meni*, the way a phone draws it.
 *
 * The laptop gets a seven-column table (`PostavkeProductRow`). On a 390 px
 * screen that table is a box the owner drags sideways, so below 1024 px the row
 * stops being a table row and becomes what it actually is — **a name and a
 * price he can change with his thumb.**
 *
 * **The row carries no badges.** It briefly wore a star for *omiljeno*, pills
 * for *osoblje* and for a missing normativ and the grams of a nargila, and six rows of
 * that is a wall of decoration around the one number the owner came to change.
 *
 * The single exception is *ugašen*, and it is not decoration: under the *Svi*
 * filter a switched-off product is otherwise identical to a live one, and
 * mistaking the two is how a price gets corrected on an item no waiter can
 * sell. It never appears under *Aktivni*, which is the default.
 *
 * **The chevron is gone and the name took its job.** A separate 44 px button
 * whose only purpose was "open this product" was spending the width the price
 * needs, next to a control the owner uses far more often. The name is now the
 * button, which is a bigger target than the chevron ever was, and the space it
 * freed is where *−* and *+* live. Nothing became unreachable: *Omiljeno*,
 * *Aktivan*, *Piće za osoblje* and *Normativ* are the same sheet, one tap away
 * on the name instead of one tap away on an arrow.
 *
 * **Why a stepper at all.** A café's prices move in halves — 2,00 to 2,50, not
 * to 2,37 — and typing one on a phone means summoning a keyboard over the list,
 * clearing a formatted number and retyping it. Two taps beat that every time.
 * The field stays for the times a price really is being set rather than nudged.
 */
import { useDebounceFn } from '@vueuse/core'
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

/** 0,50 KM, in feninga. The step a price list actually moves by. */
const STEP = 50

/**
 * The price the row is showing, which is not always the price the server holds.
 *
 * A thumb tapping *+* four times must move the number four times immediately —
 * waiting for a round trip per tap would feel broken — but it must not write
 * four times. Every price write closes one `price_history` row and opens
 * another, so four writes is four rows in the ledger describing one decision.
 * So the taps land here, the screen redraws from here, and one debounced
 * `patch` goes out when the thumb stops.
 */
const local = ref<number | null>(null)
const shown = computed(() => local.value ?? props.product.price_fen)

/** The server has caught up; hand the row back to the prop. */
watch(() => props.product.price_fen, (fresh) => {
  if (local.value !== null && fresh === local.value) local.value = null
})

const commit = useDebounceFn(() => {
  if (local.value !== null && local.value !== props.product.price_fen) {
    emit('patch', { price_fen: local.value })
  }
}, 500)

function step(delta: number) {
  // A price is never negative, and the floor is the interesting case: *Dodatni
  // žar* is a real 0,00 KM product, so 0 is a value and not an error.
  local.value = Math.max(0, shown.value + delta)
  void commit()
}

const canLower = computed(() => shown.value > 0)

/** Typing a price is absolute, so it replaces anything the stepper was holding. */
function typed(value: number | null) {
  if (value === null) return
  local.value = null
  emit('patch', { price_fen: value })
}
</script>

<template>
  <div class="p-row" :class="{ inactive: !product.active }">
    <button
      type="button"
      class="p-text"
      :aria-label="`Postavke, ${product.name}`"
      @click="emit('open')"
    >
      <span class="p-name">{{ product.name }}</span>
      <span v-if="!product.active" class="p-meta">
        <UiPill tone="bad">ugašen</UiPill>
      </span>
    </button>

    <div class="p-price">
      <button
        type="button"
        class="p-step"
        :disabled="!canLower || pending"
        :aria-label="`Smanji cijenu za 0,50 KM, ${product.name}`"
        @click="step(-STEP)"
      >
        <svg
          width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" aria-hidden="true"
        ><path d="M6 12h12" /></svg>
      </button>

      <PostavkeNum
        :model-value="shown"
        kind="money"
        :label="`Cijena, ${product.name}`"
        width="84px"
        :pending="pending"
        @commit="typed"
      />

      <button
        type="button"
        class="p-step"
        :disabled="pending"
        :aria-label="`Povećaj cijenu za 0,50 KM, ${product.name}`"
        @click="step(STEP)"
      >
        <svg
          width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" aria-hidden="true"
        ><path d="M12 6v12M6 12h12" /></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.p-row {
  display: grid;
  /* The name takes what is left and wraps rather than truncating: on this
     screen the name is how the owner knows which price he is about to change. */
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px 8px;
  padding: 8px 10px 8px 12px;
  border-bottom: 1px solid var(--line-soft);
}

.p-row:last-child { border-bottom: 0; }

/* Off the menu: the row is still readable and still editable, just quieter —
   and the *ugašen* pill says it in a word as well, because opacity alone is a
   difference somebody scrolling does not see. */
.p-row.inactive .p-text { opacity: 0.6; }

/* The name is a button and must not look like one: no border, no fill, the
   text left where it was. It is a target, not a control. */
.p-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  min-width: 0;
  min-height: var(--tap);
  justify-content: center;
  padding: 0 4px 0 0;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: var(--radius-field);
}

.p-text:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.p-name {
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--ink);
  line-height: 1.3;
}

.p-meta { display: flex; align-items: center; gap: 6px; min-width: 0; }

.p-price { display: flex; align-items: center; gap: 2px; }

.p-step {
  width: var(--tap);
  height: var(--tap);
  flex-shrink: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  border-radius: var(--radius-field);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}

.p-step:hover { background: var(--surface-2); }
.p-step:active { background: var(--line-soft); }
.p-step:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.p-step:disabled { opacity: 0.3; cursor: default; }
.p-step:disabled:hover { background: transparent; }
</style>
