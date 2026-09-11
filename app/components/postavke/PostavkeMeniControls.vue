<script setup lang="ts">
/**
 * The head of *Meni* on a phone: find a product, choose which products, add one.
 *
 * On the laptop these are three separate things spread across the page head and
 * a filter row, and there is room for that. On a 390 px screen the same three
 * things plus the favourite counter plus a three-line warning filled most of the
 * screen before a single product appeared — the owner had to scroll to reach
 * the thing he opened the page for.
 *
 * So they are two rows. **What he types is on the first one** — the search and
 * the one copper button this page is about — and what he sets rarely is on the
 * second, with the favourite counter riding along at its end rather than on a
 * line of its own.
 *
 * The counter turns warn-toned at the cap, because that is the only place the
 * screen can explain why a *Omiljeno* switch is refusing to move.
 */
defineProps<{
  show: 'aktivni' | 'svi'
  search: string
  favouriteCount: number
  /** Twelve — the number of tiles the waiter's *Omiljeno* tab holds. */
  favouriteCap: number
}>()

const emit = defineEmits<{
  'update:show': [value: 'aktivni' | 'svi']
  'update:search': [value: string]
  /** Open *Novi artikal*. */
  create: []
}>()
</script>

<template>
  <div class="p-bar">
    <div class="p-bar-row">
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

    <div class="p-bar-row">
      <UiSeg
        :model-value="show"
        label="Koji artikli"
        :options="[{ value: 'aktivni', label: 'Aktivni' }, { value: 'svi', label: 'Svi' }]"
        @update:model-value="value => emit('update:show', value as 'aktivni' | 'svi')"
      />
      <span class="p-fav" :class="{ full: favouriteCount >= favouriteCap }">
        Omiljeno <span class="num">{{ favouriteCount }} / {{ favouriteCap }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.p-bar { display: flex; flex-direction: column; gap: 10px; min-width: 0; }

.p-bar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
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

.p-fav {
  font-size: var(--text-label);
  color: var(--muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.p-fav.full { color: var(--warn); font-weight: 600; }
</style>
