<script setup lang="ts">
/**
 * *Kategorije* as a list, for the phone.
 *
 * The laptop draws one `UiCard` + `UiTable`, which is right at a desk: seven
 * columns of six categories compared at a glance. In a hand it is a 390 px box
 * dragged sideways past the name to reach a switch, so below 1024 px the table
 * is gone and this is a card of rows. Nothing here is wider than the screen.
 *
 * The list is drawn in the menu's own order, which is what the order *is* —
 * there is no *Sortiranje* number on a phone, because a column of integers is
 * not an order, it is a puzzle whose answer is an order. *Redoslijed* mode
 * turns each row into its place plus two arrows, and the sentence at the top
 * says what the order means to a waiter.
 */
import type { CategoryAdmin } from '#shared/types'

defineProps<{
  categories: CategoryAdmin[]
  /** The first read has not landed: draw bars, not an empty screen. */
  loading: boolean
  /** The Bosnian name of each `kind`, owned by the page. */
  kindLabels: Record<string, string>
  /** Rows show their place and two arrows instead of a way in. */
  reorder: boolean
  /** A move is in flight; every arrow in the list waits for it. */
  busy: boolean
}>()

const emit = defineEmits<{
  open: [category: CategoryAdmin]
  move: [category: CategoryAdmin, delta: -1 | 1]
}>()
</script>

<template>
  <div class="p-list">
    <p v-if="reorder && categories.length > 0" class="p-hint">
      Prva u nizu je prvi tab koji konobar vidi na telefonu.
    </p>

    <div v-if="loading" class="p-card p-skel" aria-hidden="true">
      <div v-for="n in 4" :key="n" class="p-skel-row">
        <span class="p-skel-bar wide" />
        <span class="p-skel-bar" />
      </div>
    </div>

    <div v-else-if="categories.length > 0" class="p-card">
      <PostavkeKatRow
        v-for="(category, index) in categories"
        :key="category.id"
        :category="category"
        :kind-label="kindLabels[category.kind] ?? category.kind"
        :position="index + 1"
        :reorder="reorder"
        :first="index === 0"
        :last="index === categories.length - 1"
        :busy="busy"
        @open="emit('open', category)"
        @move="delta => emit('move', category, delta)"
      />
    </div>

    <p v-else class="p-empty">Nema nijedne kategorije.</p>
  </div>
</template>

<style scoped>
.p-list { display: flex; flex-direction: column; gap: 10px; min-width: 0; }

.p-hint {
  margin: 0;
  padding: 0 2px;
  font-size: var(--text-micro);
  color: var(--muted);
}

.p-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  overflow: hidden;
  min-width: 0;
}

/* Bars, not a spinner over stale rows — the same shape `UiTable` draws. */
.p-skel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 16px;
  border-bottom: 1px solid var(--line-soft);
}

.p-skel-row:last-child { border-bottom: 0; }

.p-skel-bar {
  display: block;
  height: 10px;
  width: 72px;
  border-radius: var(--radius-chip);
  background: var(--surface-2);
}

.p-skel-bar.wide { width: 45%; }

.p-empty {
  margin: 0;
  padding: 22px 16px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-card);
  color: var(--muted);
  font-size: var(--text-body);
  text-align: center;
}
</style>
