<script setup lang="ts">
/**
 * ***Pokaži narudžbu*** — the phone turned around and held out to the guest.
 *
 * Guests ask what they have had and what it comes to, and until now the answer
 * was a waiter reading a list off a screen designed for his thumb. This is that
 * list, large enough to read at arm's length across a low table in a dark room.
 *
 * **It is not a receipt, and it must never be mistaken for one.** Šank issues no
 * receipts, prints nothing and has no PDV lines or receipt numbering (PLAN §3);
 * the diagonal watermark says exactly that, in Bosnian, across the middle of
 * the list where a photograph cannot crop it out. Nothing on this screen changes
 * anything — there is not one button here that writes a row, only *Zatvori*.
 * That is the point of a separate component rather than a "presentation mode"
 * on S2: a screen with no actions cannot be tapped into one.
 *
 * Struck lines are shown struck rather than hidden. A guest who watched a
 * mistake being cancelled should see it cancelled.
 */
import { formatKm } from '#shared/money'
import type { TabDetail } from '#shared/types'

defineProps<{
  tableName: string
  tab: TabDetail
}>()

defineEmits<{ close: [] }>()
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col bg-bg">
    <header class="flex min-h-14 items-center gap-2.5 border-b border-line px-4 py-2">
      <span class="chip bg-line text-text">{{ tableName }}</span>
      <span class="grow text-xl font-bold">Pregled narudžbe</span>
      <button
        type="button"
        class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
        aria-label="Zatvori"
        @click="$emit('close')"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </header>

    <!-- `relative` so the watermark can sit over the list and scroll with it. -->
    <div class="relative flex-1 overflow-y-auto px-4 py-4">
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
      >
        <span class="-rotate-[30deg] whitespace-nowrap text-center text-2xl font-bold uppercase leading-relaxed tracking-[0.12em] text-text opacity-[0.14]">
          interni pregled<br>nije fiskalni račun
        </span>
      </div>

      <ul class="relative flex flex-col gap-3">
        <template v-for="round in tab.orders" :key="round.id">
          <li v-for="row in round.lines" :key="row.id" class="flex items-baseline gap-3">
            <span
              class="min-w-0 grow text-xl"
              :class="row.status === 'storno' ? 'text-text-2 line-through' : ''"
            >
              <span class="num font-semibold">{{ row.qty }}×</span>
              {{ row.name_snapshot }}
              <small v-if="row.flavour_names.length" class="text-text-2">
                · {{ row.flavour_names.join(' + ') }}
              </small>
              <small v-if="row.status === 'gratis'" class="text-good"> · kuća časti</small>
            </span>
            <span
              class="num shrink-0 text-xl font-semibold"
              :class="row.status === 'storno' ? 'text-text-2 line-through' : ''"
            >{{ formatKm(row.charged_fen) }}</span>
          </li>
        </template>
      </ul>
    </div>

    <div class="border-t border-line px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3">
      <div class="flex items-baseline gap-3">
        <span class="grow text-xl font-semibold">Za platiti</span>
        <span class="num text-4xl font-bold">{{ formatKm(tab.money.remaining_fen) }}</span>
      </div>
      <p v-if="tab.money.paid_fen > 0" class="num mt-1 text-right text-sm text-text-2">
        Već plaćeno {{ formatKm(tab.money.paid_fen) }} od {{ formatKm(tab.money.total_fen) }}
      </p>
      <p class="mt-3 text-center text-sm text-text-2">
        Interni pregled — nije fiskalni račun.
      </p>
    </div>
  </div>
</template>
