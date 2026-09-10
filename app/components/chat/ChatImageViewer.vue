<script setup lang="ts">
/**
 * A photo, full screen.
 *
 * `touch-action: pinch-zoom` hands the gesture to the browser instead of
 * re-implementing pinch in JavaScript: the native zoom is smoother than anything
 * a listener could do and it costs one CSS line.
 *
 * The `<img>` is a plain one and the URL is the access-checked route — reopening
 * the viewer re-requests it, so a photo whose message was removed in the
 * meantime answers 404 rather than showing from cache.
 */
defineProps<{ src: string, canForward?: boolean, canRemove?: boolean }>()

const emit = defineEmits<{ close: [], forward: [], remove: [] }>()
</script>

<template>
  <div class="fixed inset-0 z-[60] flex flex-col bg-black">
    <header class="flex min-h-14 items-center gap-2 px-3">
      <button
        type="button"
        class="flex h-12 w-12 items-center justify-center rounded-control text-text"
        aria-label="Zatvori"
        @click="emit('close')"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
      <span class="grow" />
      <button v-if="canForward" type="button" class="btn btn-ghost min-h-12 px-3 text-body" @click="emit('forward')">
        Proslijedi
      </button>
      <button v-if="canRemove" type="button" class="btn btn-ghost min-h-12 px-3 text-body text-danger" @click="emit('remove')">
        Obriši
      </button>
    </header>

    <div class="flex grow items-center justify-center overflow-auto p-2" style="touch-action: pinch-zoom">
      <img :src="src" alt="Slika" class="max-h-full max-w-full object-contain">
    </div>
  </div>
</template>
