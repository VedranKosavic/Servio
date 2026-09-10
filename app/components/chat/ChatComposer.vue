<script setup lang="ts">
/**
 * The composer, pinned to the bottom of a channel.
 *
 * **The two camera buttons are one HTML input each, and nothing else.**
 * `<input type="file" accept="image/*" capture="environment">` opens the phone's
 * own camera; the same input without `capture` opens the gallery. Neither needs
 * a permission dialog of ours, neither needs `getUserMedia`, and the file that
 * comes back is handed straight to `downscale()`.
 *
 * **The field never loses focus on a poll.** Nothing here is keyed on the
 * message list, so a `since` answer arriving mid-sentence re-renders the thread
 * above and leaves the keyboard exactly where it was.
 *
 * *Pošalji* is 56 px, disabled while the draft is empty, and it is the only
 * primary action on the screen.
 */
const props = defineProps<{
  modelValue: string
  /** A send in flight: the button greys out rather than queueing twice. */
  sending?: boolean
  /** Why the composer is closed — a mute, mostly. Shown in place of the field. */
  disabledReason?: string | null
  /** An admin in *Svi* gets *Slikaj* only: a photo of a screen is deliberate. */
  allowGallery?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'send': []
  'pick': [file: File]
}>()

const camera = ref<HTMLInputElement | null>(null)
const gallery = ref<HTMLInputElement | null>(null)

const canSend = computed(() => props.modelValue.trim().length > 0 && !props.sending)

function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // The value is cleared so picking the *same* photo twice still fires `change`.
  input.value = ''
  if (file) emit('pick', file)
}
</script>

<template>
  <div class="sticky bottom-0 -mx-4 border-t border-line bg-bg px-4 pb-3 pt-2">
    <p v-if="disabledReason" class="py-3 text-center text-text-2">
      {{ disabledReason }}
    </p>

    <div v-else class="flex items-end gap-2">
      <textarea
        :value="modelValue"
        rows="1"
        class="card-2 max-h-32 min-h-12 grow resize-none px-3 py-2.5 text-text outline-none"
        placeholder="Poruka"
        aria-label="Poruka"
        @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      />

      <button
        type="button"
        class="btn h-12 w-12 shrink-0 px-0"
        aria-label="Slikaj"
        title="Slikaj"
        @click="camera?.click()"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
          <circle cx="12" cy="13" r="3.2" />
        </svg>
      </button>

      <button
        v-if="allowGallery"
        type="button"
        class="btn h-12 w-12 shrink-0 px-0"
        aria-label="Galerija"
        title="Galerija"
        @click="gallery?.click()"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 16l5-5 4 4 3-3 6 6" />
        </svg>
      </button>

      <button
        type="button"
        class="btn btn-accent h-14 shrink-0 px-4 text-base"
        :disabled="!canSend"
        @click="emit('send')"
      >
        Pošalji
      </button>
    </div>

    <!-- Two inputs, off screen. `capture` is the whole difference between them. -->
    <input
      ref="camera"
      type="file"
      accept="image/*"
      capture="environment"
      class="hidden"
      @change="onFile"
    >
    <input
      ref="gallery"
      type="file"
      accept="image/*"
      class="hidden"
      @change="onFile"
    >
  </div>
</template>
