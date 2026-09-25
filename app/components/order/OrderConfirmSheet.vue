<script setup lang="ts">
/**
 * **S5 *Narudžba*** — the sheet PLAN §10 invariant 2 has always required.
 *
 * A lock is the moment a tapped cart becomes money, stock and somebody's
 * promet, and it is irreversible — the only way back is a logged self-void — so
 * it gets one deliberate confirmation that lists **every line and the total**,
 * with the table pill as its header. There is no exception any more: the one
 * there was, *Dodatni žar*, went with the product (the owner, 25.09.2026).
 *
 * It doubles as *Pregled*: the same sheet, opened from the strip on S3, is
 * where a line's quantity is corrected. That is deliberate — it is the **button
 * twin** of the long-press on a tile (invariant 7), so nothing here depends on
 * a gesture a thumb in a cold terrace might not land.
 *
 * **Three things changed the evening the owner read it back to us.**
 *
 * *Nova tura* was our word, not the café's. A *tura* is the unit the ledger
 * counts and the bartender's ticket is headed with; what the waiter is looking
 * at before he sends it is simply **the order**, so the sheet is *Narudžba*.
 *
 * *Nazad* was the second button on a screen whose only other exit was the
 * scrim, and it did nothing the scrim did not. The real missing action was
 * throwing the round away — a waiter who has tapped four drinks at the wrong
 * table had no way to empty the cart but to subtract them one at a time. So the
 * ghost button is **Poništi turu**, it really does clear the draft, and it asks
 * once before it does: an armed second tap, not a dialog, because a dialog on
 * top of a sheet is two layers of scrim over a man holding a tray.
 *
 * The **pencil** is gone at the owner's word. Notes are not: a long press on
 * the tile writes one, which is the gesture the screen has taught since S3 and
 * the one line of help under the grid still names.
 */
import { formatKm } from '#shared/money'
import { mixLabels } from '#shared/flavours'
import type { CartLine } from '~/stores/cart'
import type { Flavour, Product } from '#shared/types'
import { stavke } from './OrderText'

const props = withDefaults(defineProps<{
  /** "Sto 7" or "Bez stola" — the pill this round belongs to. */
  tableName: string
  lines: CartLine[]
  products: Product[]
  flavours: Flavour[]
  busy?: boolean
  error?: string | null
}>(), { busy: false, error: null })

const emit = defineEmits<{
  close: []
  confirm: []
  cancel: []
  add: [lineId: string]
  remove: [lineId: string]
}>()

useSheetDismiss(() => emit('close'))

const productById = computed(() => new Map(props.products.map(p => [p.id, p])))
const flavourById = computed(() => new Map(props.flavours.map(f => [f.id, f.name])))

interface Row {
  id: string
  name: string
  qty: number
  note: string | null
  /** Folded, so a 2 : 1 mix reads "Ice 67%" once and not "Ice" twice. */
  flavours: string[]
  lineFen: number
}

const rows = computed<Row[]>(() => props.lines.map((line) => {
  const product = productById.value.get(line.product_id)
  return {
    id: line.id,
    name: product?.name ?? 'Stavka',
    qty: line.qty,
    note: line.note ?? null,
    flavours: mixLabels(line.flavour_ids ?? [], id => flavourById.value.get(id) ?? '—'),
    // The catalogue price, and only so the waiter can read the number out to a
    // guest. The body carries product ids and quantities; the server prices the
    // round when it lands, and the amber *Cijena promijenjena* card covers the
    // rare evening where the two differ.
    lineFen: (product?.price_fen ?? 0) * line.qty,
  }
}))

const count = computed(() => props.lines.reduce((n, l) => n + l.qty, 0))
const totalFen = computed(() => rows.value.reduce((sum, r) => sum + r.lineFen, 0))

/**
 * *Poništi turu* asks once. The first tap arms it and the label says so; the
 * second throws the draft away. Anything else on the sheet disarms it, so a
 * thumb that lands on it by accident and then goes anywhere else has cost
 * nothing.
 */
const armed = ref(false)

function cancelTap() {
  if (!armed.value) {
    armed.value = true
    return
  }
  armed.value = false
  emit('cancel')
}

watch(() => props.lines, () => { armed.value = false }, { deep: true })
</script>

<template>
  <div class="fixed inset-0 z-50">
    <div class="sheet-scrim" @click="emit('close')" />

    <div
      class="sheet-panel absolute inset-x-0 bottom-0 mx-auto flex max-h-[92dvh] w-full max-w-3xl flex-col gap-4 overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3"
      role="dialog"
      aria-label="Narudžba"
      @click="armed = false"
    >
      <span class="mx-auto h-1 w-10 shrink-0 rounded-full bg-line" />

      <div class="flex items-center gap-2">
        <span class="chip bg-line text-text">{{ tableName }}</span>
        <span class="section-title grow">Narudžba</span>
        <span class="num text-label text-text-2">{{ stavke(count) }}</span>
      </div>

      <p v-if="error" class="note note-danger" role="alert">
        {{ error }}
      </p>

      <ul class="flex flex-col gap-2.5">
        <!-- Two rows, not one: at 390 px a name, its aromas, a note, a stepper
             and an amount on one line squeeze the name to "Narg…". -->
        <li v-for="row in rows" :key="row.id" class="card-2 flex flex-col gap-2.5 p-3">
          <div class="flex items-baseline gap-3">
            <span class="min-w-0 grow text-body font-semibold">{{ row.name }}</span>
            <span class="num shrink-0 text-body font-semibold">{{ formatKm(row.lineFen) }}</span>
          </div>

          <div v-if="row.flavours.length || row.note" class="flex flex-wrap gap-1.5">
            <span v-for="flavour in row.flavours" :key="flavour" class="chip">{{ flavour }}</span>
            <span v-if="row.note" class="chip chip-warn">{{ row.note }}</span>
          </div>

          <!-- One control, not three buttons floating beside each other: − and
               + belong to the number between them, and a single piece of
               material is how the thumb is told that. -->
          <div class="flex justify-end">
            <div class="flex items-center overflow-hidden rounded-control bg-surface">
              <button
                type="button"
                class="flex h-12 w-12 shrink-0 items-center justify-center text-section font-bold"
                :aria-label="`Skini jedan · ${row.name}`"
                @click="emit('remove', row.id)"
              >
                −
              </button>
              <span class="num w-10 shrink-0 text-center text-body font-bold">{{ row.qty }}</span>
              <button
                type="button"
                class="flex h-12 w-12 shrink-0 items-center justify-center text-section font-bold"
                :aria-label="`Dodaj jedan · ${row.name}`"
                @click="emit('add', row.id)"
              >
                +
              </button>
            </div>
          </div>
        </li>
      </ul>

      <div class="flex items-baseline gap-2 border-t border-line pt-4">
        <span class="section-title grow">Ukupno</span>
        <span class="num text-metric font-bold">{{ formatKm(totalFen) }}</span>
      </div>

      <div class="flex flex-col gap-2">
        <button
          type="button"
          class="btn btn-primary btn-lg"
          :disabled="busy || count === 0"
          @click="emit('confirm')"
        >
          {{ busy ? 'Šaljem…' : 'Potvrdi' }}
        </button>

        <button
          type="button"
          class="btn btn-ghost"
          :class="armed ? 'text-danger' : ''"
          :disabled="busy || count === 0"
          @click.stop="cancelTap"
        >
          {{ armed ? 'Dodirni ponovo — briše cijelu turu' : 'Poništi turu' }}
        </button>
      </div>

      <p class="text-center text-label text-text-2">
        Zaključena tura se ne mijenja — greška se ispravlja stornom.
      </p>
    </div>
  </div>
</template>
