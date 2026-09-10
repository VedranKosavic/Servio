<script setup lang="ts">
/**
 * The long-press on a tile, and its button twin on a draft line: what the guest
 * asked for, in the guest's words (F2 step 4).
 *
 * The chips come from `categories.note_chips_json` — *bez šećera · s mlijekom ·
 * dupla* — because the two or three things guests actually ask for are a
 * category's property, not a hard-coded list, and the owner edits them in
 * *Meni*. A chip is one tap and closes the sheet: that is what keeps *mix
 * nargila + čaj s čipom* inside its ten-tap budget.
 *
 * The *Ostalo* product arrives here with no chips at all and the keyboard open:
 * its whole purpose is that the free text becomes the line's note ("2 kifle"),
 * because a fixed-price catch-all with no note is a number nobody can explain
 * the next morning.
 *
 * *Na račun kuće* hands off to WP1's `app/components/adjust/AdjCompSheet.vue`,
 * which owns the F7 rule — the *Osoblje: 1/2 (do 3 KM)* counter, the cap and the
 * Bosnian refusal past it. This sheet only says that the house is paying; the
 * page above swaps the sheets.
 */
const props = withDefaults(defineProps<{
  /** What the note is for — the product's name, or the line's. */
  title: string
  /** From the product's category. May be empty. */
  chips: string[]
  /** Editing an existing line's note rather than writing a new one. */
  initial?: string | null
  /** *Ostalo*: open with the keyboard up, because the text is the point. */
  freeTextFirst?: boolean
}>(), { initial: null, freeTextFirst: false })

const emit = defineEmits<{
  close: []
  save: [note: string | null]
  /** Hand over to `AdjCompSheet` (F7). */
  comp: []
}>()

useSheetDismiss(() => emit('close'))

const text = ref(props.initial ?? '')
const field = ref<HTMLInputElement | null>(null)

onMounted(() => {
  if (props.freeTextFirst) field.value?.focus()
})

function pick(chip: string) {
  emit('save', chip)
}

function saveText() {
  const trimmed = text.value.trim()
  emit('save', trimmed.length > 0 ? trimmed : null)
}
</script>

<template>
  <div class="fixed inset-0 z-50">
    <div class="sheet-scrim" @click="emit('close')" />

    <div
      class="sheet-panel absolute inset-x-0 bottom-0 mx-auto flex max-h-[92dvh] w-full max-w-3xl flex-col gap-3 overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3"
      role="dialog"
      aria-label="Napomena"
    >
      <span class="mx-auto h-1 w-10 shrink-0 rounded-full bg-line" />

      <h2 class="section-title">
        {{ title }}
      </h2>

      <div v-if="chips.length" class="flex flex-wrap gap-2">
        <button
          v-for="chip in chips"
          :key="chip"
          type="button"
          class="pill h-12"
          @click="pick(chip)"
        >
          {{ chip }}
        </button>
      </div>

      <label class="flex flex-col gap-1.5">
        <span class="text-label text-text-2">Ili napiši</span>
        <input
          ref="field"
          v-model="text"
          type="text"
          maxlength="120"
          placeholder="npr. bez leda"
          class="card-2 h-14 px-3.5 text-body outline-none placeholder:text-muted"
          @keyup.enter="saveText"
        >
      </label>

      <button type="button" class="btn btn-primary btn-lg" @click="saveText">
        Sačuvaj napomenu
      </button>

      <button type="button" class="btn h-12 justify-between" @click="emit('comp')">
        Na račun kuće
      </button>

      <button type="button" class="btn btn-ghost" @click="emit('close')">
        Otkaži
      </button>
    </div>
  </div>
</template>
