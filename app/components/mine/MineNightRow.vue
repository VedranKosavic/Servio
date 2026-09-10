<script setup lang="ts">
/**
 * One of the last thirty nights, with *Napomena* on it.
 *
 * The note is the only editable thing on this whole screen, and it is
 * deliberately editable: `staff_notes` is not a ledger table (PHASE3 §1.6), it
 * has no trigger and no correction chain, because it is one person's own words
 * about his own night — *"kasnio sam sat, dogovoreno s Harisom"* — and a note
 * nobody can correct is a note nobody writes.
 *
 * It saves on blur and on *Sačuvaj*, never on a keystroke: this runs on a phone
 * on café wifi, and a `PUT` per letter is how a note ends up half-written on the
 * server. Only *Sačuvaj* closes the box — a blur that also closed it would race
 * the tap that caused the blur, and the tap would land on nothing.
 */
import { formatKm } from '#shared/money'
import type { MyShiftRow } from '#shared/types'

const props = defineProps<{
  row: MyShiftRow
  /**
   * The page's own `PUT`, handed in as a function rather than emitted as an
   * event — the row has to *await* it before it closes the editor, and an
   * `emit` gives nothing back to await.
   */
  save: (shiftId: string, body: string) => Promise<void>
}>()

const open = ref(false)
const draft = ref(props.row.note ?? '')
const saving = ref(false)

/**
 * The save that is currently in flight, if any.
 *
 * Tapping *Sačuvaj* blurs the textarea first, so two handlers fire for one tap:
 * the blur starts the `PUT`, and the tap must **wait for that one** rather than
 * start a second or give up and leave the box open. One promise, awaited by
 * both.
 */
let pending: Promise<void> = Promise.resolve()

// The row is re-rendered from the server after a save; keep the box in step
// with it rather than trusting what we typed.
watch(() => props.row.note, (note) => { draft.value = note ?? '' })

const dirty = computed(() => draft.value.trim() !== (props.row.note ?? ''))

/** `"2026-09-08"` → `"08.09.2026."`, the Bosnian written date with its dot. */
function dateText(businessDate: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(businessDate)
  return parts ? `${parts[3]}.${parts[2]}.${parts[1]}.` : businessDate
}

function hoursText(hours: number): string {
  return `${hours.toFixed(1).replace('.', ',')} h`
}

function diffLabel(fen: number): string {
  if (fen === 0) return 'Tačno'
  return fen > 0 ? `Višak ${formatKm(fen)}` : `Manjak ${formatKm(Math.abs(fen))}`
}

async function submit(close: boolean) {
  if (dirty.value && !saving.value) {
    saving.value = true
    pending = props.save(props.row.shift_id, draft.value.trim())
      .finally(() => { saving.value = false })
  }
  await pending
  if (close) open.value = false
}
</script>

<template>
  <div class="flex flex-col gap-2 border-t border-line py-3 first:border-t-0 first:pt-0">
    <div class="flex items-baseline justify-between gap-3">
      <span class="num text-body font-semibold">{{ dateText(row.business_date) }}</span>
      <span class="num text-label text-text-2">{{ hoursText(row.hours) }}</span>
    </div>

    <div class="flex items-baseline justify-between gap-3 text-label">
      <span class="text-text-2">
        <template v-if="row.declared_fen === null">Pazar nije predan</template>
        <template v-else>Predao {{ formatKm(row.declared_fen) }}</template>
      </span>
      <span
        v-if="row.diff_fen !== null"
        class="num"
        :class="row.diff_fen === 0 ? 'text-good' : 'text-warn'"
      >{{ diffLabel(row.diff_fen) }}</span>
    </div>

    <!-- The note: shown when it exists, otherwise one tap away. -->
    <button
      v-if="!open"
      type="button"
      class="flex min-h-12 items-start gap-2 rounded-control px-1 text-left text-label"
      :class="row.note ? 'text-text' : 'text-text-2'"
      @click="open = true"
    >
      <svg
        class="mt-0.5 shrink-0"
        width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
      >
        <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
      </svg>
      <span class="grow">{{ row.note || 'Napomena' }}</span>
    </button>

    <div v-else class="flex flex-col gap-2">
      <textarea
        v-model="draft"
        rows="3"
        maxlength="500"
        placeholder="Npr. kasnio sam sat, dogovoreno."
        class="card-2 w-full resize-none px-3.5 py-2.5 text-body outline-none placeholder:text-muted"
        aria-label="Napomena"
        @blur="submit(false)"
      />
      <div class="flex gap-2">
        <!--
          Deliberately never `disabled`. Tapping this blurs the textarea first,
          which starts the save and would flip a `:disabled` binding on before
          the tap finished — and a disabled button dispatches no click at all,
          so the box would stay open forever. It says what it is doing instead.
        -->
        <button
          type="button"
          class="btn btn-primary grow"
          @click="submit(true)"
        >
          {{ saving ? 'Čuvam…' : 'Sačuvaj' }}
        </button>
        <button
          type="button"
          class="btn btn-ghost"
          @click="open = false; draft = row.note ?? ''"
        >
          Zatvori
        </button>
      </div>
      <p class="text-label text-text-2">
        Prazna napomena je briše. Vlasnik je vidi uz tvoj red u smjeni.
      </p>
    </div>
  </div>
</template>
