<script setup lang="ts">
/**
 * One item on *Brzi popis*: a name, one big number, and nothing the shelf can
 * argue with.
 *
 * **The theoretical quantity is not on this screen.** Not greyed out, not in a
 * tooltip, not "for reference" — absent. A screen that shows what it expects
 * before the number is typed is not a count, it is a confirmation dialogue, and
 * the one thing a count is for is the difference between what is expected and
 * what is there (PLAN §7 F9). Everything the row knows about variance appears
 * only after *Predaj*, in `PopisResult`.
 *
 * Two ways to count, decided by the item and not by the person:
 *   - `count` — whole packs or loose pieces, one toggle, one number;
 *   - `weigh` — gross grams off the kitchen scale, with the tare named on
 *     screen and subtracted by the server (never here: the phone does not
 *     compute a quantity the ledger will store).
 */
import type { StockItem } from '#shared/types'

const props = defineProps<{
  item: StockItem
  /** The typed number, as typed: "" until somebody counts this row. */
  value: string
  /** For a packed item: is the number packs or single pieces? */
  unit: 'pack' | 'base'
  note: string
  /** The server sent this row back needing a note (422 `NOTE_REQUIRED`). */
  needsNote?: boolean
}>()

const emit = defineEmits<{
  'update:value': [string]
  'update:unit': ['pack' | 'base']
  'update:note': [string]
}>()

const weighed = computed(() => props.item.count_method === 'weigh')
const packable = computed(() => !weighed.value && (props.item.pack_qty ?? 0) > 1)

/** The tare is the empty tin. Named on screen so nobody subtracts it twice. */
const tare = computed(() => (weighed.value ? props.item.tare_g ?? 0 : 0))

const typed = computed(() => parseDecimalInput(props.value))
const filled = computed(() => typed.value !== null)

/** The note field opens on demand, or because the server asked for one. */
const noteOpen = ref(false)
watch(() => props.needsNote, (needs) => { if (needs) noteOpen.value = true }, { immediate: true })

/**
 * What the row says under the field: never the expected quantity, only what
 * this number means. "2 gajbe = 48 kom", "neto 603 g".
 */
const hint = computed(() => {
  if (!filled.value) return null
  if (weighed.value) {
    if (tare.value <= 0) return null
    const net = Math.max(0, typed.value! - tare.value)
    return `minus tara ${tare.value} g · neto ${formatStockQty(net, props.item.base_unit)}`
  }
  if (props.unit === 'pack' && packable.value) {
    const pieces = typed.value! * (props.item.pack_qty ?? 0)
    return `${props.item.pack_name ?? 'pakovanje'} × ${props.item.pack_qty} = ${formatStockQty(pieces, props.item.base_unit)}`
  }
  return null
})

const suffix = computed(() => {
  if (weighed.value) return 'g'
  return props.unit === 'pack' ? (props.item.pack_name ?? 'pak') : props.item.base_unit
})

const fieldId = computed(() => `popis-${props.item.id}`)
</script>

<template>
  <div
    :id="fieldId"
    class="card flex flex-col gap-2 p-3"
    :class="needsNote ? 'border-warn' : 'border-line'"
  >
    <div class="flex items-baseline justify-between gap-2">
      <span class="text-body font-semibold">{{ item.name }}</span>
      <!-- One chip, and it says the thing that matters most right now: whether
           this row still needs a number, and only then how it is measured. -->
      <span v-if="filled" class="chip chip-good shrink-0">popisano</span>
      <span v-else-if="weighed" class="chip shrink-0">na vagi</span>
      <span v-else class="chip shrink-0">nije popisano</span>
    </div>

    <div class="flex items-stretch gap-2">
      <label class="sr-only" :for="`${fieldId}-input`">{{ item.name }}</label>
      <!-- The field's placeholder is an em dash and not "0": a grey zero on
           fourteen rows, under a counter that says nothing has been counted and
           a foot that says "upiši i nulu", is the screen contradicting itself.
           The em dash is what the app writes everywhere else for "no value". -->
      <div class="flex grow items-center gap-2 rounded-control border border-line bg-surface-2 px-3">
        <input
          :id="`${fieldId}-input`"
          class="num min-h-13 w-full bg-transparent text-metric font-bold outline-none"
          inputmode="decimal"
          autocomplete="off"
          placeholder="—"
          :value="value"
          @input="emit('update:value', ($event.target as HTMLInputElement).value)"
        >
        <span class="shrink-0 text-body text-text-2">{{ suffix }}</span>
      </div>

      <!-- The toggle exists only where a pack does: a bottle is a bottle. -->
      <div v-if="packable" class="flex shrink-0 overflow-hidden rounded-control border border-line">
        <button
          type="button"
          class="min-h-13 px-3 text-label font-semibold"
          :class="unit === 'pack' ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-text-2'"
          @click="emit('update:unit', 'pack')"
        >
          {{ item.pack_name ?? 'pak' }}
        </button>
        <button
          type="button"
          class="min-h-13 px-3 text-label font-semibold"
          :class="unit === 'base' ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-text-2'"
          @click="emit('update:unit', 'base')"
        >
          {{ item.base_unit }}
        </button>
      </div>
    </div>

    <p v-if="hint" class="num text-label text-text-2">
      {{ hint }}
    </p>

    <p v-if="needsNote" class="text-label text-warn">
      Ova stavka odstupa više od dozvoljenog — napiši šta se desilo.
    </p>

    <!-- A control with a box, not an underlined word: fourteen of these sit on
         the first screen, and an underlined text link was both the only one in
         `/konobar` and 19 px tall against a 48 px floor. `.btn-sm` reads
         `--tap`, so it is right in either area without knowing which it is in. -->
    <button
      v-if="!noteOpen"
      type="button"
      class="btn btn-ghost btn-sm self-start"
      @click="noteOpen = true"
    >
      Napomena
    </button>
    <input
      v-else
      class="input"
      :placeholder="needsNote ? 'Obavezna napomena' : 'Napomena (nije obavezna)'"
      maxlength="200"
      :value="note"
      @input="emit('update:note', ($event.target as HTMLInputElement).value)"
    >
  </div>
</template>
