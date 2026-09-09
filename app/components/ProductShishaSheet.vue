<script setup lang="ts">
/**
 * Choosing the aromas for a nargila.
 *
 * A bowl is one to three aromas, and the grams the server takes off the shelf
 * are split between whichever ones are picked here — so this sheet is the only
 * place in the waiter app where a choice changes what leaves the stock.
 *
 * An aroma at zero is shown, greyed and labelled "Nema", never hidden: the
 * waiter needs to know the café is out of jabuka, not wonder where it went.
 */
import { formatKm } from '#shared/money'
import type { Flavour, Product } from '#shared/types'

const props = defineProps<{
  product: Product
  flavours: Flavour[]
}>()

defineEmits<{ close: [], confirm: [flavourIds: string[]] }>()

const MAX = 3
const selected = ref<string[]>([])

function toggle(flavour: Flavour) {
  if (flavour.on_hand <= 0) return
  const at = selected.value.indexOf(flavour.id)
  if (at >= 0) selected.value.splice(at, 1)
  else if (selected.value.length < MAX) selected.value.push(flavour.id)
}

const canAdd = computed(() => selected.value.length > 0)
</script>

<template>
  <div class="fixed inset-0 z-50">
    <div class="absolute inset-0 bg-black/55" @click="$emit('close')" />

    <div class="absolute inset-x-0 bottom-0 mx-auto flex max-h-[85dvh] w-full max-w-3xl flex-col gap-3 rounded-t-[20px] border-t border-line bg-surface px-4 pb-6 pt-3">
      <div class="mx-auto h-1 w-10 rounded-sm bg-line" />

      <div class="flex items-center gap-3">
        <span class="grow text-lg font-bold">{{ props.product.name }}</span>
        <span class="chip num">Mix {{ selected.length }}/{{ MAX }}</span>
      </div>
      <p class="text-sm text-text-2">
        Izaberi 1–3 arome.
      </p>

      <div class="flex flex-wrap gap-2 overflow-y-auto">
        <button
          v-for="flavour in props.flavours"
          :key="flavour.id"
          type="button"
          class="flex min-h-12 items-center gap-2 rounded-3xl border-[1.5px] px-4 text-base font-semibold"
          :class="[
            selected.includes(flavour.id)
              ? 'border-accent bg-accent text-accent-ink'
              : 'border-line bg-surface-2 text-text',
            flavour.on_hand <= 0 ? 'opacity-45' : '',
          ]"
          :disabled="flavour.on_hand <= 0"
          @click="toggle(flavour)"
        >
          {{ flavour.name }}
          <span v-if="flavour.on_hand <= 0" class="chip chip-danger">Nema</span>
        </button>
      </div>

      <button
        type="button"
        class="btn btn-accent h-14 text-lg"
        :disabled="!canAdd"
        @click="$emit('confirm', [...selected])"
      >
        Dodaj nargilu · <span class="num">{{ formatKm(props.product.price_fen) }}</span>
      </button>
      <button type="button" class="btn btn-ghost" @click="$emit('close')">
        Otkaži
      </button>
    </div>
  </div>
</template>
