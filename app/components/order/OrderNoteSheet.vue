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
 * *Na račun kuće* is listed and disabled. The comp sheet belongs to WP1 (PHASE3
 * §3, WP1); listing the row now and greying it out is the house pattern — a
 * menu that grows an item every week teaches nobody where anything is, and a
 * disabled row that says *stiže uskoro* is honest.
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

const emit = defineEmits<{ close: [], save: [note: string | null] }>()

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
    <div class="absolute inset-0 bg-black/55" @click="emit('close')" />

    <div
      class="absolute inset-x-0 bottom-0 mx-auto flex max-h-[92dvh] w-full max-w-3xl flex-col gap-3 overflow-y-auto rounded-t-[20px] border-t border-line bg-surface px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3"
      role="dialog"
      aria-label="Napomena"
    >
      <span class="mx-auto h-1 w-10 shrink-0 rounded-full bg-line" />

      <h2 class="text-lg font-bold">
        {{ title }}
      </h2>

      <div v-if="chips.length" class="flex flex-wrap gap-2">
        <button
          v-for="chip in chips"
          :key="chip"
          type="button"
          class="flex min-h-12 items-center rounded-3xl border-[1.5px] border-line bg-surface-2 px-4 text-base font-semibold"
          @click="pick(chip)"
        >
          {{ chip }}
        </button>
      </div>

      <label class="flex flex-col gap-1.5">
        <span class="text-sm text-text-2">Ili napiši</span>
        <input
          ref="field"
          v-model="text"
          type="text"
          maxlength="120"
          placeholder="npr. bez leda"
          class="card-2 h-14 px-3.5 text-[17px] outline-none placeholder:text-muted"
          @keyup.enter="saveText"
        >
      </label>

      <button type="button" class="btn btn-accent h-14 text-lg" @click="saveText">
        Sačuvaj napomenu
      </button>

      <!-- WP1 replaces this row with its comp sheet (PHASE3 §3, WP1). -->
      <button type="button" class="btn h-12 justify-between" disabled>
        <span>Na račun kuće</span>
        <span class="chip">stiže uskoro</span>
      </button>

      <button type="button" class="btn btn-ghost h-12" @click="emit('close')">
        Otkaži
      </button>
    </div>
  </div>
</template>
