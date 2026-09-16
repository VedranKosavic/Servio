<script setup lang="ts">
/**
 * *Oduzima sa stanja* for an article that is already on the menu.
 *
 * It replaced the *Normativ* editor (the owner, 16.09.2026): a menu article is
 * a piece of one shelf article, a dose of coffee, a nargila, or nothing — never
 * a list of ingredients typed by hand — so the sheet is the one choice and its
 * article, and *Sačuvaj* sends all three columns at once.
 */
import type { ProductAdmin, StockItemAdmin } from '#shared/types'
import type { UpdateProductBody } from '#shared/schemas'
import {
  zalihaArticleOf, zalihaModeOf, zalihaPatch, zalihaReady, type ZalihaMode,
} from '~/utils/menuZaliha'

const props = defineProps<{
  open: boolean
  product: ProductAdmin | null
  items: StockItemAdmin[]
  pending: boolean
  error: string | null
}>()

const emit = defineEmits<{ close: [], save: [patch: UpdateProductBody] }>()

const mode = ref<ZalihaMode>('nista')
const articleId = ref<string | null>(null)

watch(() => [props.open, props.product?.id] as const, ([open]) => {
  if (!open || !props.product) return
  mode.value = zalihaModeOf(props.product)
  articleId.value = zalihaArticleOf(props.product)
}, { immediate: true })

const canSave = computed(() => zalihaReady(mode.value, articleId.value) && !props.pending)

function save() {
  if (!canSave.value) return
  emit('save', zalihaPatch(mode.value, articleId.value))
}
</script>

<template>
  <UiSheet
    :open="open"
    :title="product ? `${product.name} · stanje šanka` : 'Stanje šanka'"
    :pending="pending"
    @close="emit('close')"
    @confirm="save"
  >
    <p v-if="error" class="z-error" role="alert">{{ error }}</p>

    <PostavkeZalihaFields
      v-model:mode="mode"
      v-model:article-id="articleId"
      :items="items"
      :category-id="product?.category_id"
    />

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Odustani</UiButton>
      <UiButton variant="primary" :disabled="!canSave" :pending="pending" @click="save">
        Sačuvaj
      </UiButton>
    </template>
  </UiSheet>
</template>

<style scoped>
.z-error {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: var(--text-micro);
}
</style>
