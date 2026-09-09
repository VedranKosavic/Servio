<script setup lang="ts">
/**
 * The six screens of *Meni i postavke*, as one strip of chips.
 *
 * The left nav has one item for all of them ("Meni i postavke"), so this is what
 * actually moves the owner between the catalogue, the floor plan, the staff, the
 * phones and the thresholds. On a phone the strip scrolls sideways inside its
 * own box; the page body never does.
 */
const route = useRoute()

const tabs = [
  { to: '/a/meni', label: 'Meni' },
  { to: '/a/postavke/kategorije', label: 'Kategorije' },
  { to: '/a/postavke/stolovi', label: 'Stolovi' },
  { to: '/a/postavke/osoblje', label: 'Osoblje' },
  { to: '/a/postavke/uredaji', label: 'Uređaji' },
  { to: '/a/postavke', label: 'Podešavanja' },
]

// Exact match, not `startsWith`: `/a/postavke` is *Podešavanja* itself and must
// not light up while `/a/postavke/stolovi` is open.
const isOn = (to: string) => route.path === to
</script>

<template>
  <nav class="p-tabs" aria-label="Meni i postavke">
    <NuxtLink
      v-for="tab in tabs"
      :key="tab.to"
      :to="tab.to"
      class="p-tab"
      :class="{ on: isOn(tab.to) }"
      :aria-current="isOn(tab.to) ? 'page' : undefined"
    >{{ tab.label }}</NuxtLink>
  </nav>
</template>

<style scoped>
.p-tabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  min-width: 0;
  padding-bottom: 2px;
  -webkit-overflow-scrolling: touch;
}

.p-tab {
  height: 32px;
  padding: 0 12px;
  border-radius: 16px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  text-decoration: none;
}

.p-tab.on {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}

@media (max-width: 1023px) {
  .p-tab { height: 44px; padding: 0 16px; font-size: 15px; }
}
</style>
