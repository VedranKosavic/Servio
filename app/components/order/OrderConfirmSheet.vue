<script setup lang="ts">
/**
 * **S5 *Zaključi*** — the sheet PLAN §10 invariant 2 has always required and
 * the app has never had.
 *
 * Until Phase 3 the send button posted the round straight from the screen. A
 * lock is the moment a tapped cart becomes money, stock and somebody's promet,
 * and it is irreversible — the only way back is a logged self-void — so it gets
 * one deliberate confirmation on a sheet that lists **every line and the
 * total**, with the table pill as its header. The single exception in the whole
 * app is a 0 KM system product (*Žar*), which locks on one explicit tap.
 *
 * It doubles as *Pregled*: the same sheet, opened from the strip on S3, is
 * where a line's quantity is corrected and where its note is written. That is
 * deliberate too — it is the **button twin** of the long-press on a tile
 * (invariant 7), so nothing here depends on a gesture a thumb in a cold terrace
 * might not land.
 */
import { formatKm } from '#shared/money'
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
  add: [lineId: string]
  remove: [lineId: string]
  note: [lineId: string]
}>()

useSheetDismiss(() => emit('close'))

const productById = computed(() => new Map(props.products.map(p => [p.id, p])))
const flavourById = computed(() => new Map(props.flavours.map(f => [f.id, f.name])))

interface Row {
  id: string
  name: string
  qty: number
  note: string | null
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
    flavours: (line.flavour_ids ?? []).map(id => flavourById.value.get(id) ?? '—'),
    // The catalogue price, and only so the waiter can read the number out to a
    // guest. The body carries product ids and quantities; the server prices the
    // round when it lands, and the amber *Cijena promijenjena* card covers the
    // rare evening where the two differ.
    lineFen: (product?.price_fen ?? 0) * line.qty,
  }
}))

const count = computed(() => props.lines.reduce((n, l) => n + l.qty, 0))
const totalFen = computed(() => rows.value.reduce((sum, r) => sum + r.lineFen, 0))
</script>

<template>
  <div class="fixed inset-0 z-50">
    <div class="sheet-scrim" @click="emit('close')" />

    <div
      class="sheet-panel absolute inset-x-0 bottom-0 mx-auto flex max-h-[92dvh] w-full max-w-3xl flex-col gap-3 overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3"
      role="dialog"
      aria-label="Zaključi turu"
    >
      <span class="mx-auto h-1 w-10 shrink-0 rounded-full bg-line" />

      <div class="flex items-center gap-2">
        <span class="chip bg-line text-text">{{ tableName }}</span>
        <span class="section-title grow">Nova tura</span>
        <span class="num text-label text-text-2">{{ stavke(count) }}</span>
      </div>

      <p v-if="error" class="note note-danger" role="alert">
        {{ error }}
      </p>

      <ul class="flex flex-col gap-2">
        <!-- Two rows, not one: at 390 px a name, its aromas, a note, two
             steppers and an amount on one line squeeze the name to "Narg…". -->
        <li v-for="row in rows" :key="row.id" class="card-2 flex flex-col gap-2 p-2.5">
          <div class="flex items-baseline gap-2">
            <span class="min-w-0 grow text-body font-semibold">{{ row.name }}</span>
            <span class="num shrink-0 text-body font-semibold">{{ formatKm(row.lineFen) }}</span>
          </div>

          <div v-if="row.flavours.length || row.note" class="flex flex-wrap gap-1.5">
            <span v-for="flavour in row.flavours" :key="flavour" class="chip">{{ flavour }}</span>
            <span v-if="row.note" class="chip chip-warn">{{ row.note }}</span>
          </div>

          <div class="flex items-center gap-2">
            <button
              type="button"
              class="flex h-12 w-12 shrink-0 items-center justify-center rounded-control bg-surface"
              :aria-label="`Napomena · ${row.name}`"
              @click="emit('note', row.id)"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                <path d="M5 12h.01M12 12h.01M19 12h.01" />
              </svg>
            </button>

            <span class="grow" />

            <button
              type="button"
              class="flex h-12 w-12 shrink-0 items-center justify-center rounded-control bg-surface text-xl font-bold"
              :aria-label="`Skini jedan · ${row.name}`"
              @click="emit('remove', row.id)"
            >
              −
            </button>
            <span class="num w-8 shrink-0 text-center text-body font-bold">{{ row.qty }}</span>
            <button
              type="button"
              class="flex h-12 w-12 shrink-0 items-center justify-center rounded-control bg-surface text-xl font-bold"
              :aria-label="`Dodaj jedan · ${row.name}`"
              @click="emit('add', row.id)"
            >
              +
            </button>
          </div>
        </li>
      </ul>

      <div class="flex items-baseline gap-2 border-t border-line pt-3">
        <span class="section-title grow">Ukupno</span>
        <span class="num text-2xl font-bold">{{ formatKm(totalFen) }}</span>
      </div>

      <button
        type="button"
        class="btn btn-primary btn-lg"
        :disabled="busy || count === 0"
        @click="emit('confirm')"
      >
        {{ busy ? 'Šaljem…' : 'Potvrdi' }}
      </button>
      <button type="button" class="btn btn-ghost" :disabled="busy" @click="emit('close')">
        Nazad
      </button>
      <p class="text-center text-label text-text-2">
        Zaključena tura se ne mijenja — greška se ispravlja stornom.
      </p>
    </div>
  </div>
</template>
