<script setup lang="ts">
/**
 * What a long-press on a **locked** line says (F6 step 1).
 *
 * PLAN §10 invariant 8: a forbidden action is explained and offered a path, and
 * never silently greyed out. So pressing a line that is already money does not
 * do nothing — it says why, in one sentence, and points at the only way back,
 * which is a storno somebody signs for.
 *
 * The *Zatraži storno* button belongs to WP1 (PHASE3 §3): the reason chips, the
 * restock line, the bartender's PIN and the amber "ostaje u tvom pazaru" copy
 * are its sheet, `app/components/adjust/AdjVoidSheet.vue`. Until it lands, the
 * row is listed and disabled with *stiže uskoro* — the house pattern for a
 * screen another package owns — and this component is where WP1 swaps it in.
 */
import { formatKm } from '#shared/money'
import type { TabLine } from '#shared/types'

defineProps<{
  line: TabLine
  /** "Tura 2 · 21:05 · Amar" — which round it belongs to. */
  round: string
}>()

defineEmits<{ close: [] }>()
</script>

<template>
  <div class="fixed inset-0 z-50">
    <div class="absolute inset-0 bg-black/55" @click="$emit('close')" />

    <div
      class="absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-t-[20px] border-t border-line bg-surface px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3"
      role="dialog"
      aria-label="Zaključena stavka"
    >
      <span class="mx-auto h-1 w-10 shrink-0 rounded-full bg-line" />

      <div class="flex items-baseline gap-2">
        <span class="grow text-lg font-bold">
          <span class="num">{{ line.qty }}×</span> {{ line.name_snapshot }}
        </span>
        <span class="num text-lg font-semibold">{{ formatKm(line.charged_fen) }}</span>
      </div>
      <p class="text-sm text-text-2">
        {{ round }}
        <template v-if="line.flavour_names.length">· {{ line.flavour_names.join(' + ') }}</template>
      </p>

      <p class="rounded-xl bg-surface-2 px-3 py-2 text-[15px]">
        Zaključene stavke se ne mijenjaju. Greška se ispravlja stornom, i storno
        se vidi.
      </p>

      <!-- WP1 replaces this with AdjVoidSheet (PHASE3 §3, WP1). -->
      <button type="button" class="btn h-14 justify-between text-lg" disabled>
        <span>Zatraži storno</span>
        <span class="chip">stiže uskoro</span>
      </button>

      <button type="button" class="btn btn-ghost h-12" @click="$emit('close')">
        Zatvori
      </button>
    </div>
  </div>
</template>
