<script setup lang="ts">
/**
 * The otpremnica, pinned above the draft and tappable to full screen.
 *
 * A scan is only checkable if the paper is next to the numbers, so the photo
 * stays on the screen the whole time the owner is editing. Full screen is a
 * native `<img>` inside a scroller with `touch-action: pinch-zoom` — the
 * browser's own zoom is better than anything we would write, and the small print
 * on an A4 note is exactly what has to be readable.
 *
 * `GET /api/uploads/:id` is access-checked per request and answers 404 rather
 * than 403 when it refuses, so a broken image here means "not yours", never
 * "does not exist".
 */
const props = defineProps<{
  /** `/api/uploads/:id`, or a local object URL while the server copy is fresh. */
  src: string
  alt?: string
}>()

const open = ref(false)
const broken = ref(false)

watch(() => props.src, () => { broken.value = false })

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
}

watch(open, (isOpen) => {
  if (import.meta.server) return
  if (isOpen) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  if (import.meta.client) window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="a-foto">
    <button v-if="!broken" type="button" class="a-thumb" @click="open = true">
      <img :src="src" :alt="alt ?? 'Otpremnica'" @error="broken = true">
      <span class="a-thumb-hint">Dodirni za cijelu sliku</span>
    </button>
    <p v-else class="a-muted">Slika nije dostupna.</p>

    <div v-if="open" class="a-full" @click="open = false">
      <img :src="src" :alt="alt ?? 'Otpremnica'">
      <UiButton variant="soft" class="a-close" @click.stop="open = false">Zatvori</UiButton>
    </div>
  </div>
</template>

<style scoped>
.a-foto { min-width: 0; }

.a-thumb {
  display: block;
  width: 100%;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg);
  cursor: zoom-in;
  overflow: hidden;
}

.a-thumb img { display: block; width: 100%; max-height: 240px; object-fit: contain; }

.a-thumb-hint {
  display: block;
  padding: 6px 10px;
  font-size: var(--text-caption);
  color: var(--muted);
  text-align: left;
}

.a-full {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: var(--scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  overflow: auto;
  /* The browser's own pinch zoom, which is better than any we would write. */
  touch-action: pinch-zoom;
}

.a-full img { max-width: 100%; max-height: 100%; object-fit: contain; }
.a-close { position: fixed; right: 16px; bottom: 16px; }
.a-muted { margin: 0; color: var(--muted); font-size: var(--text-micro); }
</style>
