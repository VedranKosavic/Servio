<script setup lang="ts">
/**
 * **S4 *Nargila*** — packing the bowl.
 *
 * A bowl is one to three aromas and the grams that leave the shelf are split
 * between them, so this is the only sheet in the waiter app where a choice
 * changes what leaves the stock. What is new is that the split is no longer
 * always even: the waiter taps out the **proportion**, and the proportion he
 * taps is the proportion that is deducted.
 *
 * **How a mix is held.** A list with repeats — `["ice","ice","swiss"]` is two
 * parts *Ice* to one part *Swiss*. `shared/flavours.ts` explains why that shape
 * and not a second field: `resolveStock()` already divides the bowl's grams
 * evenly across the entries of `flavour_ids`, so a repeated id takes a second
 * share without one line of server code being written, and the wire schema's
 * existing `.min(1).max(3)` is exactly the cap the owner described.
 *
 * **The taps.** A tap on an aroma the bowl has not got adds it. A tap on one it
 * has gives it another part — and with two aromas that is the whole vocabulary:
 * 50/50, then 67/33 either way round. Three aromas are thirds and stay thirds,
 * which is what the owner asked for in the same breath ("max 3, so 33 each").
 * With a single aroma there is no proportion to change, so a second tap on it
 * takes it back out — the behaviour this sheet has always had.
 *
 * **The bar is the answer, and also the undo.** It reads left to right in the
 * order they were tapped, each aroma's width being its share; the chips under
 * it name them, and tapping a chip takes that aroma out. Its colours are
 * `--cat-1..3`, the five hues `main.css` keeps for things whose only difference
 * is *where they landed in a list* — a mix is position and not meaning, so it
 * must not reach for the copper or for the good/warn pair.
 *
 * An aroma at zero is shown, greyed and labelled "Nema", never hidden: the
 * waiter needs to know the café is out of jabuka, not wonder where it went.
 *
 * The chips at the foot are the category's own note chips — *jači*, *blaži* —
 * optional by design: the default bowl is two taps away and that is what keeps
 * *nargila + 2× Coca-Cola* inside its eight-tap budget.
 */
import { formatKm } from '#shared/money'
import { flavourShares } from '#shared/flavours'
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

useSheetDismiss(() => emit('close'))

/** Both caps are the wire schema's: `flavour_ids` is `.min(1).max(3)`. */
const MAX_FLAVOURS = 3
const MAX_PARTS = 3

/** Distinct aromas in the order they were tapped — the order the bar reads in. */
const picked = ref<string[]>([])
/** How many parts each has. Every picked aroma has at least one. */
const parts = ref<Record<string, number>>({})

const note = ref<string | null>(null)

const totalParts = computed(() =>
  picked.value.reduce((n, id) => n + (parts.value[id] ?? 0), 0))

/**
 * The bowl as the wire carries it: one entry per part, aromas in tap order.
 *
 * This is the value the sheet exists to produce, and it is the same array the
 * stock deduction walks — which is why the bar above it cannot disagree with
 * what comes off the shelf.
 */
const flavourIds = computed(() => picked.value
  .flatMap(id => Array.from({ length: parts.value[id] ?? 0 }, () => id)))

const shares = computed(() => flavourShares(flavourIds.value))

const nameById = computed(() => new Map(props.flavours.map(f => [f.id, f.name])))

/**
 * The most parts one aroma may hold, given how many are in the bowl: every
 * other aroma keeps at least one, and three parts is the cap. Two aromas can
 * therefore go 1 or 2; three are locked at one each.
 */
const ceilingPerFlavour = computed(() => MAX_PARTS - (picked.value.length - 1))

function tap(flavour: Flavour) {
  if (flavour.on_hand <= 0) return
  const id = flavour.id

  if (!picked.value.includes(id)) {
    if (picked.value.length >= MAX_FLAVOURS) return
    // A bowl already at 2 : 1 has no room for a third aroma, so adding one
    // levels the bowl first — 2 : 1 plus a new aroma is thirds, which is the
    // only place three aromas can sit anyway.
    if (totalParts.value + 1 > MAX_PARTS) {
      parts.value = Object.fromEntries(picked.value.map(other => [other, 1]))
    }
    picked.value = [...picked.value, id]
    parts.value = { ...parts.value, [id]: 1 }
    return
  }

  // The only aroma in the bowl: there is no proportion to change, so the tap
  // that put it in takes it out again.
  if (picked.value.length === 1) {
    remove(id)
    return
  }

  const next = ((parts.value[id] ?? 1) % ceilingPerFlavour.value) + 1
  // Everything else drops to one part, which is what keeps the bowl at three:
  // with two aromas, one of them going to two forces the other to one.
  parts.value = Object.fromEntries(
    picked.value.map(other => [other, other === id ? next : 1]),
  )
}

function remove(id: string) {
  picked.value = picked.value.filter(other => other !== id)
  const next = { ...parts.value }
  delete next[id]
  parts.value = next
}

function pickNote(chip: string) {
  note.value = note.value === chip ? null : chip
}

/** "Al Fakher · Limun-menta" → "Limun-menta": the bar has a third of a phone. */
function shortName(id: string): string {
  const name = nameById.value.get(id) ?? '—'
  const cut = name.lastIndexOf('·')
  return cut === -1 ? name : name.slice(cut + 1).trim()
}

const canAdd = computed(() => picked.value.length > 0)
</script>

<template>
  <div class="fixed inset-0 z-50">
    <div class="sheet-scrim" @click="emit('close')" />

    <div
      class="sheet-panel absolute inset-x-0 bottom-0 mx-auto flex max-h-[88dvh] w-full max-w-3xl flex-col gap-4 overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3"
      role="dialog"
      :aria-label="props.product.name"
    >
      <span class="mx-auto h-1 w-10 shrink-0 rounded-full bg-line" />

      <div class="flex items-center gap-3">
        <span class="section-title grow">{{ props.product.name }}</span>
        <span class="chip num">{{ picked.length }}/{{ MAX_FLAVOURS }}</span>
      </div>

      <!-- The bowl, as a bar. Empty it is a track with the instruction in it,
           so the sheet never opens on a blank strip nobody can read. -->
      <div class="flex flex-col gap-2">
        <div
          class="flex h-11 overflow-hidden rounded-control bg-bg-2"
          role="img"
          :aria-label="shares.length
            ? shares.map(s => `${nameById.get(s.id) ?? ''} ${s.pct}%`).join(', ')
            : 'Prazna lula'"
        >
          <span
            v-for="(share, index) in shares"
            :key="share.id"
            class="mix-part flex min-w-0 items-center justify-center px-1"
            :class="`mix-${index + 1}`"
            :style="{ flexGrow: share.parts }"
          >
            <span class="num truncate text-label font-bold">{{ share.pct }}%</span>
          </span>

          <span
            v-if="!shares.length"
            class="flex grow items-center justify-center text-label text-muted"
          >
            Izaberi aromu
          </span>
        </div>

        <!-- The legend, and the way back out: a chip is one aroma, and tapping
             it removes that aroma from the bowl. -->
        <div v-if="shares.length" class="flex flex-wrap gap-2">
          <button
            v-for="(share, index) in shares"
            :key="share.id"
            type="button"
            class="chip flex items-center gap-2 py-1.5"
            :aria-label="`Izbaci ${nameById.get(share.id)}`"
            @click="remove(share.id)"
          >
            <span class="mix-dot" :class="`mix-${index + 1}`" aria-hidden="true" />
            <span class="truncate">{{ shortName(share.id) }}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" class="shrink-0 text-muted" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>

      <p class="text-label text-text-2">
        {{ picked.length > 1
          ? 'Dodirni aromu ponovo za veći udio.'
          : 'Dodirni aromu. Do tri arome u luli.' }}
      </p>

      <div class="flex flex-wrap gap-2">
        <button
          v-for="flavour in props.flavours"
          :key="flavour.id"
          type="button"
          class="pill h-12"
          :class="[
            picked.includes(flavour.id) ? 'pill-on' : '',
            flavour.on_hand <= 0 ? 'opacity-45' : '',
          ]"
          :disabled="flavour.on_hand <= 0"
          :aria-pressed="picked.includes(flavour.id)"
          @click="tap(flavour)"
        >
          {{ flavour.name }}
          <span v-if="(parts[flavour.id] ?? 0) > 1" class="num chip chip-accent">×{{ parts[flavour.id] }}</span>
          <span v-if="flavour.on_hand <= 0" class="chip chip-danger">Nema</span>
        </button>
      </div>

      <!-- A different question, so it says so. Flavour pills (they change what
           is made and what leaves the shelf) sitting directly above note pills
           in the same shape, size and material gave the waiter no way to see
           that the last row asks something else. -->
      <div v-if="props.noteChips.length" class="flex flex-col gap-2 border-t border-line-soft pt-4">
        <span class="eyebrow">Napomena</span>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="chip in props.noteChips"
            :key="chip"
            type="button"
            class="pill h-12"
            :class="note === chip ? 'pill-on' : ''"
            @click="pickNote(chip)"
          >
            {{ chip }}
          </button>
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <button
          type="button"
          class="btn btn-primary btn-lg"
          :disabled="!canAdd"
          @click="emit('confirm', [...flavourIds], note)"
        >
          Dodaj nargilu ·<span class="num">{{ formatKm(props.product.price_fen) }}</span>
        </button>
        <button type="button" class="btn btn-ghost" @click="emit('close')">
          Otkaži
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/**
 * Position, not meaning.
 *
 * `--cat-1..3` are three of the five hues `main.css` keeps for exactly this —
 * slices whose only difference is where they landed in a list. A mix bar that
 * reached for `--accent` would be saying "this aroma is yours" and one that
 * reached for `--good` would be saying "this aroma is fine".
 */
.mix-part { color: var(--color-bg); }

.mix-1 { background: var(--color-cat-1); }
.mix-2 { background: var(--color-cat-2); }
.mix-3 { background: var(--color-cat-3); }

.mix-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  flex-shrink: 0;
}
</style>
