<script setup lang="ts">
/**
 * **S4 *Nargila*** — choosing what goes in the bowl.
 *
 * A bowl is one to three aromas, and the grams the server takes off the shelf
 * are split between whichever ones are picked here — so this sheet is the only
 * place in the waiter app where a choice changes what leaves the stock.
 *
 * An aroma at zero is shown, greyed and labelled "Nema", never hidden: the
 * waiter needs to know the café is out of jabuka, not wonder where it went.
 *
 * The chips under the aromas are the category's own note chips — *jači*,
 * *blaži* — and they are optional by design: the default bowl is one tap away
 * and that is what keeps *nargila + 2× Coca-Cola* inside its eight-tap budget.
 * Picking one writes the line's `note`, which is what the bartender reads on
 * his ticket.
 */
import { formatKm } from '#shared/money'
import type { Flavour, Product } from '#shared/types'

const props = withDefaults(defineProps<{
  product: Product
  flavours: Flavour[]
  /** From the product's category (`note_chips`). Empty is normal. */
  noteChips?: string[]
}>(), { noteChips: () => [] })

const emit = defineEmits<{
  close: []
  confirm: [flavourIds: string[], note: string | null]
}>()

const MAX = 3
const selected = ref<string[]>([])
const note = ref<string | null>(null)

function toggle(flavour: Flavour) {
  if (flavour.on_hand <= 0) return
  const at = selected.value.indexOf(flavour.id)
  if (at >= 0) selected.value.splice(at, 1)
  else if (selected.value.length < MAX) selected.value.push(flavour.id)
}

function pickNote(chip: string) {
  note.value = note.value === chip ? null : chip
}

const canAdd = computed(() => selected.value.length > 0)
</script>

<template>
  <div class="fixed inset-0 z-50">
    <div class="absolute inset-0 bg-black/55" @click="emit('close')" />

    <div class="absolute inset-x-0 bottom-0 mx-auto flex max-h-[85dvh] w-full max-w-3xl flex-col gap-3 rounded-t-[20px] border-t border-line bg-surface px-4 pb-6 pt-3">
      <div class="mx-auto h-1 w-10 rounded-sm bg-line" />

      <div class="flex items-center gap-3">
        <span class="section-title grow">{{ props.product.name }}</span>
        <span class="chip num">Mix {{ selected.length }}/{{ MAX }}</span>
      </div>
      <p class="text-label text-text-2">
        Izaberi 1–3 arome.
      </p>

      <div class="flex flex-wrap gap-2 overflow-y-auto">
        <button
          v-for="flavour in props.flavours"
          :key="flavour.id"
          type="button"
          class="pill h-12"
          :class="[
            selected.includes(flavour.id)
              ? 'pill-on'
              : '',
            flavour.on_hand <= 0 ? 'opacity-45' : '',
          ]"
          :disabled="flavour.on_hand <= 0"
          @click="toggle(flavour)"
        >
          {{ flavour.name }}
          <span v-if="flavour.on_hand <= 0" class="chip chip-danger">Nema</span>
        </button>
      </div>

      <div v-if="props.noteChips.length" class="flex flex-wrap gap-2">
        <button
          v-for="chip in props.noteChips"
          :key="chip"
          type="button"
          class="pill h-12"
          :class="note === chip
            ? 'pill-on'
            : ''"
          @click="pickNote(chip)"
        >
          {{ chip }}
        </button>
      </div>

      <button
        type="button"
        class="btn btn-primary btn-lg"
        :disabled="!canAdd"
        @click="emit('confirm', [...selected], note)"
      >
        Dodaj nargilu · <span class="num">{{ formatKm(props.product.price_fen) }}</span>
      </button>
      <button type="button" class="btn btn-ghost" @click="emit('close')">
        Otkaži
      </button>
    </div>
  </div>
</template>
