<script setup lang="ts">
/**
 * What the count found — the first moment this screen is allowed to show a
 * theoretical quantity (F9 step 3).
 *
 * Lines out of tolerance come first, because they are the only ones anybody
 * will act on; the rest are there so the person who counted can see his own
 * work. The money is the shelf's, not anybody's: a variance is priced at cost,
 * marked *procijenjeno* when that cost is a fallback, and nothing here is
 * charged to a person.
 *
 * Below it, *Potvrđujem stanje* — the incoming custodian taps once, on this
 * phone, and the count carries both names to the owner. It is deliberately not
 * a gate: an unwitnessed count is submitted, complete and useful, and the owner
 * sees the missing signature as an attention line rather than the count being
 * missing altogether.
 */
import { formatKm } from '#shared/money'
import type { CountView } from '#shared/types'

const props = defineProps<{
  count: CountView
  /** Whoever is holding the phone now — the counter cannot witness himself. */
  meId: string | null
  busy?: boolean
  error?: string | null
}>()

defineEmits<{ witness: [], done: [] }>()

const lines = computed(() => [...props.count.lines].sort((a, b) => {
  if (a.out_of_tolerance !== b.out_of_tolerance) return a.out_of_tolerance ? -1 : 1
  return Math.abs(b.variance_qty) - Math.abs(a.variance_qty)
}))

const totals = computed(() => props.count.totals)

/** Negative is a manjak: less on the shelf than the ledger says. */
const varianceWord = computed(() => {
  const fen = totals.value.variance_fen
  if (fen === 0) return 'Nema razlike'
  return fen < 0 ? `Manjak ${formatKm(Math.abs(fen))}` : `Višak ${formatKm(fen)}`
})

const canWitness = computed(() =>
  props.count.witnessed_by === null && props.meId !== null && props.meId !== props.count.counted_by)

function qty(value: number, unit: CountView['lines'][number]['base_unit']): string {
  return value > 0 ? `+${formatStockQty(value, unit)}` : formatStockQty(value, unit)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="card flex flex-col gap-2 p-4">
      <h2 class="text-xl font-bold">
        Popis predan
      </h2>
      <div class="flex flex-wrap items-center gap-2">
        <span class="chip">{{ totals.lines }} stavki</span>
        <span class="chip" :class="totals.out_of_tolerance > 0 ? 'chip-warn' : 'chip-good'">
          {{ totals.out_of_tolerance }} van tolerancije
        </span>
        <span class="chip" :class="totals.variance_fen < 0 ? 'chip-danger' : totals.variance_fen > 0 ? 'chip-warn' : 'chip-good'">
          {{ varianceWord }}
        </span>
      </div>
      <p class="text-[15px] text-text-2">
        Stanje se ne mijenja odmah — vlasnik potvrđuje popis i tek tada se roba
        koriguje.
      </p>
    </div>

    <div class="card divide-y divide-line">
      <div
        v-for="row in lines"
        :key="row.id"
        class="flex flex-col gap-1 px-4 py-3"
      >
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-[17px]">{{ row.item_name }}</span>
          <span
            class="num shrink-0 font-bold"
            :class="row.out_of_tolerance ? (row.variance_qty < 0 ? 'text-danger' : 'text-warn') : 'text-text-2'"
          >
            {{ row.variance_qty === 0 ? 'tačno' : qty(row.variance_qty, row.base_unit) }}
          </span>
        </div>
        <div class="num flex flex-wrap gap-x-3 text-sm text-text-2">
          <span>popisano {{ formatStockQty(row.counted_qty, row.base_unit) }}</span>
          <span>očekivano {{ formatStockQty(row.theoretical_qty, row.base_unit) }}</span>
          <span v-if="row.variance_fen !== 0">
            {{ formatKm(row.variance_fen) }}<template v-if="row.estimated"> · procijenjeno</template>
          </span>
        </div>
        <p v-if="row.note" class="text-sm text-text-2">
          {{ row.note }}
        </p>
      </div>
    </div>

    <div class="card flex flex-col gap-3 p-4">
      <h3 class="text-lg font-semibold">
        Potvrda stanja
      </h3>

      <p v-if="count.witnessed_by" class="text-[17px] text-good">
        Stanje potvrdio: {{ count.witnessed_by_name }}
      </p>
      <template v-else>
        <p class="text-[15px] text-text-2">
          Kolega koji preuzima šank potvrđuje stanje na ovom telefonu. Popis bez
          potvrde vrijedi — vlasnik samo vidi da potvrde nema.
        </p>
        <button
          type="button"
          class="btn btn-accent min-h-14 text-lg"
          :disabled="!canWitness || busy"
          @click="$emit('witness')"
        >
          Potvrđujem stanje
        </button>
        <p v-if="!canWitness && meId === count.counted_by" class="text-sm text-text-2">
          Ti si popisivao — potvrđuje neko drugi, sa svoje prijave.
        </p>
      </template>

      <p v-if="error" class="text-[15px] text-danger">
        {{ error }}
      </p>
    </div>

    <button type="button" class="btn btn-ghost min-h-14 text-lg" @click="$emit('done')">
      Gotovo
    </button>
  </div>
</template>
