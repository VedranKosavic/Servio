<script setup lang="ts">
/**
 * What a long-press on a **locked** line says (F6 step 1).
 *
 * PLAN §10 invariant 8: a forbidden action is explained and offered a path, and
 * never silently greyed out. So pressing a line that is already money does not
 * do nothing — it says why, in one sentence, and points at the only way back,
 * which is a storno somebody signs for.
 *
 * *Zatraži storno* hands off to WP1's own sheet,
 * `app/components/adjust/AdjVoidSheet.vue`, which is where the reason chips, the
 * restock line, the self-void countdown, the bartender's PIN and the amber
 * "ostaje u tvom pazaru" copy live. This sheet only decides *that* a storno is
 * being asked for; the page above owns which sheet is open.
 */
import { formatKm } from '#shared/money'
import type { TabLine } from '#shared/types'

defineProps<{
  line: TabLine
  /** "Tura 2 · 21:05 · Amar" — which round it belongs to. */
  round: string
}>()

defineEmits<{
  close: []
  /** Hand over to `AdjVoidSheet` — the page swaps the sheets. */
  storno: []
}>()
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
        <span class="section-title grow">
          <span class="num">{{ line.qty }}×</span> {{ line.name_snapshot }}
        </span>
        <span class="num text-body font-semibold">{{ formatKm(line.charged_fen) }}</span>
      </div>
      <p class="text-label text-text-2">
        {{ round }}
        <template v-if="line.flavour_names.length">· {{ line.flavour_names.join(' + ') }}</template>
      </p>

      <p class="note">
        Zaključene stavke se ne mijenjaju. Greška se ispravlja stornom, i storno
        se vidi.
      </p>

      <button
        type="button"
        class="btn btn-secondary btn-lg justify-between"
        @click="$emit('storno')"
      >
        Zatraži storno
      </button>

      <button type="button" class="btn btn-ghost" @click="$emit('close')">
        Zatvori
      </button>
    </div>
  </div>
</template>
