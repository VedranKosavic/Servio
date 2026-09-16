<script setup lang="ts">
/**
 * *Oduzima sa stanja* — the choice itself, drawn inside a sheet.
 *
 * Shared by *Novi artikal* and by the sheet that edits an existing article, so
 * the four ways (`app/utils/menuZaliha.ts`) look and behave the same in both.
 * The article list follows the mode — pieces for *Po komadu*, coffee for *Troši
 * kafu* — and prefers the article's own category, because *Meni* shows the
 * articles of *Stanje šanka* by the same categories (the owner, 16.09.2026).
 */
import type { StockItemAdmin } from '#shared/types'
import { articlesFor, ZALIHA_MODE_OPTIONS, type ZalihaMode } from '~/utils/menuZaliha'

const props = defineProps<{
  mode: ZalihaMode
  articleId: string | null
  items: StockItemAdmin[]
  /** The menu article's category — its own articles come first. */
  categoryId?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:mode': [mode: ZalihaMode]
  'update:articleId': [id: string | null]
}>()

const options = computed(() => {
  const all = articlesFor(props.mode, props.items)
  const own = all.filter(item => item.category_id === props.categoryId)
  const rest = all.filter(item => item.category_id !== props.categoryId)
  const sorted = [...own, ...rest]
  return [
    { value: '', label: sorted.length ? 'Izaberi artikal sa stanja' : 'Nema takvih artikala na stanju' },
    ...sorted.map(item => ({
      value: item.id,
      label: item.category_id === props.categoryId || !item.category_name
        ? item.name
        : `${item.name} · ${item.category_name}`,
    })),
  ]
})

const hint = computed(() => {
  switch (props.mode) {
    case 'komad': return 'Svaka prodaja skida 1 komad tog artikla sa stanja šanka.'
    case 'kafa': return 'Svaka prodaja skida jednu dozu kafe — koliko grama, podešava se u Gramaža.'
    case 'nargila': return 'Konobar bira okuse; doza iz Gramaža se dijeli na izabrane okuse.'
    default: return 'Prodaje se, ali se ništa ne skida sa stanja šanka.'
  }
})

function setMode(value: ZalihaMode) {
  emit('update:mode', value)
  // An article chosen for one mode is not an answer for another.
  emit('update:articleId', null)
}
</script>

<template>
  <div class="z-fields">
    <span class="z-caption">Oduzima sa stanja</span>
    <UiSeg
      :model-value="mode"
      label="Oduzima sa stanja"
      :options="[...ZALIHA_MODE_OPTIONS]"
      @update:model-value="value => setMode(value as ZalihaMode)"
    />
    <UiField
      v-if="mode === 'komad' || mode === 'kafa'"
      :model-value="articleId ?? ''"
      :label="mode === 'kafa' ? 'Kafa sa stanja' : 'Artikal sa stanja'"
      kind="select"
      :options="options"
      :disabled="disabled"
      @update:model-value="value => emit('update:articleId', value ? String(value) : null)"
    />
    <p class="z-hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.z-fields { display: flex; flex-direction: column; gap: 10px; min-width: 0; }

.z-caption {
  font-size: var(--text-caption);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  font-weight: 600;
}

.z-hint { margin: 0; color: var(--muted); font-size: var(--text-micro); }
</style>
