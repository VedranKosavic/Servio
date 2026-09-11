<script setup lang="ts">
/**
 * The head of *Meni* on a phone: find a product, add one. That is all of it.
 *
 * It used to be two rows — a search and *Novi artikal*, then an *Aktivni / Svi*
 * segment with a favourite counter riding at its end — above a three-line
 * warning about changing prices mid-shift. Between them they filled most of a
 * 390 px screen before a single product appeared, and the owner had to scroll
 * to reach the thing he opened the page for.
 *
 * All three went on the owner's call. **The filter went with them and the list
 * now shows every product, switched off ones included** — which is why the row
 * keeps its *ugašen* mark: it is the only thing separating a live product from a
 * dead one now that there is no filter saying which you are looking at.
 */
defineProps<{
  search: string
}>()

const emit = defineEmits<{
  'update:search': [value: string]
  /** Open *Novi artikal*. */
  create: []
}>()
</script>

<template>
  <div class="p-bar">
    <input
      :value="search"
      class="p-search"
      type="search"
      placeholder="Traži artikal"
      aria-label="Traži artikal"
      @input="emit('update:search', ($event.target as HTMLInputElement).value)"
    >
    <UiButton variant="primary" @click="emit('create')">
      <!-- The kit has no plus. Same 24 px grid and 1.8 stroke as `UiIcon`. -->
      <svg
        width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.8" stroke-linecap="round" aria-hidden="true"
      ><path d="M12 5v14M5 12h14" /></svg>
      Novi artikal
    </UiButton>
  </div>
</template>

<style scoped>
.p-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.p-search {
  height: var(--tap);
  flex-grow: 1;
  min-width: 0;
  border-radius: var(--radius-field);
  border: 1px solid var(--line);
  background: var(--field-bg);
  padding: 0 12px;
  font: inherit;
  /* 16 px, so iOS does not zoom the page when the field takes focus. */
  font-size: var(--text-section);
  color: var(--ink);
}

.p-search::placeholder { color: var(--muted); }
.p-search:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
</style>
