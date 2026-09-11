<script setup lang="ts">
/**
 * A photo from a thread, full screen, in the light kit.
 *
 * The `<img>` points at the access-checked `GET /api/uploads/:id`, so reopening
 * the viewer re-requests it: a photo whose message was removed in the meantime
 * answers 404 rather than showing from a cache. `touch-action: pinch-zoom`
 * hands the gesture to the browser instead of re-implementing pinch in
 * JavaScript.
 *
 * **The one surface in `/admin` that is not paper.** A photo needs a neutral
 * dark surround or the white page tints everything in it, and the palette has
 * no black — `--scrim` is a 42 % warm veil meant to sit *over* a page, not
 * behind a photograph. `/konobar`'s `ChatImageViewer` reaches for `bg-black`
 * for the same reason; this is that value, carried over from the page this
 * component was lifted out of rather than invented here.
 */
defineProps<{ src: string }>()

const emit = defineEmits<{ close: [] }>()

useSheetDismiss(() => emit('close'))
</script>

<template>
  <div class="a-viewer" @click.self="emit('close')">
    <img :src="src" alt="Slika">
    <button type="button" class="a-viewer-close" @click="emit('close')">Zatvori</button>
  </div>
</template>

<style scoped>
.a-viewer {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgb(0 0 0 / 0.9);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 16px;
  padding-bottom: calc(16px + env(safe-area-inset-bottom));
}

.a-viewer img {
  max-width: 100%;
  max-height: 80vh;
  object-fit: contain;
  touch-action: pinch-zoom;
}

.a-viewer-close {
  min-height: var(--tap);
  padding: 0 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-field);
  background: var(--surface-2);
  color: var(--ink);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
</style>
