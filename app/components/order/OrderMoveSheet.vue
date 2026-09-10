<script setup lang="ts">
/**
 * The two things behind ⋯ that hand a tab to somebody or somewhere else:
 * ***Premjesti sto*** (the guests changed table) and ***Predaj sto kolegi***
 * (you are going home, he is not).
 *
 * One sheet, because from where a waiter stands they are the same gesture —
 * "this table is not mine any more" — and two sheets would be two places to
 * look for it.
 *
 * **Both are online only, deliberately** (PLAN §5, F5). A move has to be checked
 * against the partial unique index that keeps one open tab per table, and a
 * handover the colleague has not seen yet is not a handover: he has to tap
 * *Prihvati*. Neither can be answered by a phone with no signal, so neither is
 * queued — the sheet says so instead of pretending.
 *
 * **Money does not follow the tab.** Rounds stay attributed to whoever locked
 * them, so nobody's promet moves; what moves is who answers for what happens
 * next. The sentence at the bottom says that, because a waiter handing over a
 * busy table at 23:00 deserves to know it.
 */
import type { MeUser, VenueTable } from '#shared/types'

const props = withDefaults(defineProps<{
  tableName: string
  /** Tables with no open tab — the only ones a move can land on. */
  freeTables: VenueTable[]
  /** Everyone but me. A handover to myself is not a handover. */
  colleagues: MeUser[]
  /** The queue is not empty, or the last poll failed: neither action can run. */
  offline?: boolean
  busy?: boolean
  error?: string | null
}>(), { offline: false, busy: false, error: null })

const emit = defineEmits<{
  close: []
  move: [tableId: string]
  hand: [userId: string]
}>()

useSheetDismiss(() => emit('close'))

/** Which half is open. *Premjesti* first: it is the commoner of the two. */
const mode = ref<'move' | 'hand'>('move')

const zoneLabel = (zone: VenueTable['zone']) => (zone === 'basta' ? 'Bašta' : 'Unutra')
</script>

<template>
  <div class="fixed inset-0 z-50">
    <div class="sheet-scrim" @click="emit('close')" />

    <div
      class="sheet-panel absolute inset-x-0 bottom-0 mx-auto flex max-h-[92dvh] w-full max-w-3xl flex-col gap-3 overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3"
      role="dialog"
      aria-label="Premjesti ili predaj sto"
    >
      <span class="mx-auto h-1 w-10 shrink-0 rounded-full bg-line" />

      <div class="flex items-center gap-2">
        <span class="chip bg-line text-text">{{ tableName }}</span>
      </div>

      <div class="flex gap-2">
        <button
          v-for="option in ([
            { id: 'move', label: 'Premjesti sto' },
            { id: 'hand', label: 'Predaj sto kolegi' },
          ] as const)"
          :key="option.id"
          type="button"
          class="pill h-12 flex-1 justify-center"
          :class="mode === option.id ? 'pill-on' : ''"
          @click="mode = option.id"
        >
          {{ option.label }}
        </button>
      </div>

      <p v-if="offline" class="note note-warn">
        Nema veze — ovo traži internet. Sto ostaje kod tebe.
      </p>
      <p v-else-if="error" class="note note-danger" role="alert">
        {{ error }}
      </p>

      <template v-if="mode === 'move'">
        <p class="text-label text-text-2">
          Gosti su sjeli za drugi sto. Sve dosadašnje ture idu s njima.
        </p>
        <p v-if="freeTables.length === 0" class="py-4 text-center text-label text-text-2">
          Nema slobodnog stola.
        </p>
        <div v-else class="grid grid-cols-3 gap-2">
          <button
            v-for="table in freeTables"
            :key="table.id"
            type="button"
            class="btn h-14 flex-col gap-0"
            :disabled="busy || offline"
            @click="emit('move', table.id)"
          >
            <span class="text-body font-semibold">{{ table.name }}</span>
            <small class="text-caption font-normal text-text-2">{{ zoneLabel(table.zone) }}</small>
          </button>
        </div>
      </template>

      <template v-else>
        <p class="text-label text-text-2">
          Kolega mora prihvatiti sto na svom telefonu. Tvoje ture ostaju tvoje —
          mijenja se samo ko dalje vodi sto.
        </p>
        <button
          v-for="person in colleagues"
          :key="person.id"
          type="button"
          class="btn btn-secondary btn-lg justify-start"
          :disabled="busy || offline"
          @click="emit('hand', person.id)"
        >
          <span class="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-label font-bold">
            {{ person.initials }}
          </span>
          {{ person.name }}
        </button>
        <p v-if="colleagues.length === 0" class="py-4 text-center text-label text-text-2">
          Niko drugi nije na spisku.
        </p>
      </template>

      <button type="button" class="btn btn-ghost" :disabled="busy" @click="emit('close')">
        Otkaži
      </button>
    </div>
  </div>
</template>
