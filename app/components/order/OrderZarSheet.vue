<script setup lang="ts">
/**
 * ***Žar*** — the two-tap path of F4, and the one carve-out from the *Zaključi →
 * Potvrdi* rule.
 *
 * A nargila burns down every twenty minutes and the guest asks for coal by
 * raising a hand. Anything more than two taps and the app loses to shouting
 * across the room, so: long-press the table on S1 (or the inline chip on the
 * shisha line in S2) → this sheet → *Žar*. It locks immediately, as a round of
 * its own, carrying the `system_key: 'zar'` product with `parent_line_id`
 * pointing at the bowl it tops up.
 *
 * The carve-out is safe because of what the product is: 0 KM. Nothing is
 * charged, so there is nothing to confirm a price for — but two pieces of coal
 * leave the box and the ledger says so, which is the whole reason *Žar* is an
 * order and not a shrug.
 *
 * With one live bowl on the table it is one tap here (two from S1). With two it
 * is three, because the app must not guess which bowl.
 */
import type { TabLine } from '#shared/types'

const props = defineProps<{
  tableName: string
  /** The live shisha lines on this tab — one card each. */
  bowls: (TabLine & { round: string })[]
  /** Null while the catalogue has no product with `system_key: 'zar'`. */
  zarName: string | null
  loading?: boolean
  error?: string | null
  busy?: boolean
}>()

const emit = defineEmits<{ close: [], zar: [lineId: string] }>()

const single = computed(() => (props.bowls.length === 1 ? props.bowls[0]! : null))
</script>

<template>
  <div class="fixed inset-0 z-50">
    <div class="absolute inset-0 bg-black/55" @click="emit('close')" />

    <div
      class="absolute inset-x-0 bottom-0 mx-auto flex max-h-[85dvh] w-full max-w-3xl flex-col gap-3 overflow-y-auto rounded-t-[20px] border-t border-line bg-surface px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3"
      role="dialog"
      aria-label="Dodatni žar"
    >
      <span class="mx-auto h-1 w-10 shrink-0 rounded-full bg-line" />

      <div class="flex items-center gap-2">
        <span class="chip bg-line text-text">{{ tableName }}</span>
        <span class="section-title grow">Dodatni žar</span>
      </div>

      <p v-if="loading" class="py-6 text-center text-text-2">
        Učitavanje…
      </p>

      <p v-else-if="error" class="note note-danger" role="alert">
        {{ error }}
      </p>

      <p v-else-if="!zarName" class="note note-warn">
        Nema proizvoda za žar u meniju — javi vlasniku.
      </p>

      <p v-else-if="bowls.length === 0" class="py-4 text-center text-label text-text-2">
        Na ovom stolu nema upaljene nargile.
      </p>

      <!-- One bowl: one tap, and the sheet says which bowl it is topping up. -->
      <template v-else-if="single">
        <p class="text-label text-text-2">
          {{ single.name_snapshot }}
          <span v-if="single.flavour_names.length">· {{ single.flavour_names.join(' + ') }}</span>
          · {{ single.round }}
        </p>
        <button
          type="button"
          class="btn btn-primary btn-lg"
          :disabled="busy"
          @click="emit('zar', single.id)"
        >
          {{ busy ? 'Šaljem…' : 'Žar' }}
        </button>
      </template>

      <!-- Two bowls: the app must not guess which one went out. -->
      <template v-else>
        <p class="text-label text-text-2">
          Koja nargila?
        </p>
        <button
          v-for="bowl in bowls"
          :key="bowl.id"
          type="button"
          class="btn btn-secondary btn-lg justify-between"
          :disabled="busy"
          @click="emit('zar', bowl.id)"
        >
          <span class="truncate">
            {{ bowl.flavour_names.join(' + ') || bowl.name_snapshot }}
          </span>
          <span class="chip">{{ bowl.round }}</span>
        </button>
      </template>

      <button type="button" class="btn btn-ghost" :disabled="busy" @click="emit('close')">
        Otkaži
      </button>
    </div>
  </div>
</template>
