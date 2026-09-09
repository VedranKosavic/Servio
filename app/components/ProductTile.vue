<script setup lang="ts">
/**
 * One item on the order screen. A tap anywhere on the tile is +1 — that is the
 * whole interaction, and it has to survive a thumb in a dark room.
 *
 * The "−" only appears once something is on the tile, and it is its own 48 px
 * button sitting on top of the tile rather than inside it: a button inside a
 * button is invalid HTML, so the tile is a button and the minus is a sibling
 * placed over its corner.
 */
import { formatKm } from '#shared/money'

withDefaults(defineProps<{
  name: string
  priceFen: number
  /** How many are already on the draft round. 0 hides the badge and the "−". */
  qty: number
  /** Nargila: the tap opens the aroma sheet instead of adding straight away. */
  shisha?: boolean
}>(), { shisha: false })

defineEmits<{ add: [], remove: [] }>()
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="card flex min-h-24 w-full flex-col justify-between gap-2 p-2.5 text-left"
      @click="$emit('add')"
    >
      <span class="flex w-full items-start justify-between gap-1">
        <span class="text-base font-semibold leading-tight">{{ name }}</span>
        <span v-if="shisha" class="shrink-0 text-accent">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 1-3-1-5 1-9z" />
          </svg>
        </span>
      </span>
      <span class="num text-sm text-text-2">{{ formatKm(priceFen) }}</span>
    </button>

    <span
      v-if="qty > 0"
      class="num absolute -right-2 -top-2 flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-bg bg-accent px-1.5 text-sm font-bold text-accent-ink"
    >{{ qty }}</span>

    <button
      v-if="qty > 0"
      type="button"
      class="absolute bottom-0 right-0 flex h-12 w-12 items-center justify-center rounded-br-[14px] rounded-tl-xl bg-surface-2 text-xl font-bold text-text"
      :aria-label="`Skini jedan · ${name}`"
      @click.stop="$emit('remove')"
    >
      −
    </button>
  </div>
</template>
