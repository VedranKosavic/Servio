<script setup lang="ts">
/**
 * *Slika* — the small picture on the waiter's tile (the owner, 17.09.2026).
 *
 * The phone shrinks the picture to 400 px before it leaves (`downscale`), so a
 * photo straight off the camera becomes a few tens of kilobytes; the server
 * checks it is a JPEG and not too big, and answers the product again.
 */
import type { ProductAdmin } from '#shared/types'
import { downscale, ImageDecodeError, IMAGE_ERROR } from '~/utils/image'

const props = defineProps<{ product: ProductAdmin, disabled?: boolean, compact?: boolean }>()
const emit = defineEmits<{ saved: [product: ProductAdmin] }>()

const api = useAdminApi()
const input = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const error = ref('')

async function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  ;(event.target as HTMLInputElement).value = ''
  if (!file || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const small = await downscale(file, { maxEdge: 400, quality: 0.8 })
    emit('saved', await api.setProductImage(props.product.id, small.blob))
  } catch (err) {
    error.value = err instanceof ImageDecodeError ? IMAGE_ERROR : apiErrorText(err, 'Slika nije sačuvana.')
  } finally {
    busy.value = false
  }
}

async function remove() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    emit('saved', await api.deleteProductImage(props.product.id))
  } catch (err) {
    error.value = apiErrorText(err, 'Slika nije uklonjena.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <span class="pi" :class="{ compact }">
    <img v-if="product.image_url" :src="product.image_url" alt="" class="pi-thumb" loading="lazy">
    <UiButton small variant="ghost" :pending="busy" :disabled="disabled || busy" @click="input?.click()">
      {{ product.image_url ? 'Promijeni' : 'Dodaj sliku' }}
    </UiButton>
    <UiButton v-if="product.image_url && !compact" small variant="ghost" :disabled="disabled || busy" @click="remove">
      Ukloni
    </UiButton>
    <button
      v-if="product.image_url && compact"
      type="button"
      class="pi-x"
      :aria-label="`Ukloni sliku, ${product.name}`"
      :disabled="disabled || busy"
      @click="remove"
    >×</button>
    <input ref="input" type="file" accept="image/*" class="pi-file" @change="onFile">
    <small v-if="error" class="pi-error" role="alert">{{ error }}</small>
  </span>
</template>

<style scoped>
.pi { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pi-thumb { width: 40px; height: 40px; border-radius: 8px; object-fit: cover; border: 1px solid var(--line); }
.compact .pi-thumb { width: 32px; height: 32px; }
.pi-file { display: none; }
.pi-x {
  width: 28px; height: 28px; border: 0; border-radius: var(--radius-field);
  background: transparent; color: var(--muted); font-size: 18px; cursor: pointer;
}
.pi-x:hover { background: var(--surface-2); color: var(--ink); }
.pi-error { flex-basis: 100%; color: var(--danger); font-size: var(--text-micro); }
</style>
