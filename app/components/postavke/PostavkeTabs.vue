<script setup lang="ts">
/**
 * The eight screens of *Meni i postavke*, as one strip of chips.
 *
 * The left nav has one item for all of them ("Meni i postavke"), so this is what
 * actually moves the owner between the catalogue, the floor plan, the staff, the
 * phones and the thresholds. On a phone the strip scrolls sideways inside its
 * own box; the page body never does.
 */
const route = useRoute()

const tabs = [
  { to: '/admin/meni', label: 'Meni' },
  { to: '/admin/postavke/kategorije', label: 'Kategorije' },
  { to: '/admin/postavke/stolovi', label: 'Stolovi' },
  { to: '/admin/postavke/osoblje', label: 'Osoblje' },
  { to: '/admin/postavke/uredaji', label: 'Uređaji' },
  // Phase 4, WP2. Reachability: without a chip here the page has no way in.
  { to: '/admin/postavke/sabloni', label: 'Šabloni' },
  { to: '/admin/postavke', label: 'Podešavanja' },
  { to: '/admin/postavke/pravila', label: 'Pravila' },
]

// Exact match, not `startsWith`: `/admin/postavke` is *Podešavanja* itself and must
// not light up while `/admin/postavke/stolovi` is open.
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
/**
 * The tab strip, shared shape.
 *
 * *Roba* used to draw its six tabs as a segmented well and *Meni i postavke* drew
 * its eight as copper pills — two different ideas of "the same page, a different
 * part" in one product, which is exactly what makes an app feel assembled rather
 * than designed. Both are now an underlined bar: the row reads as one strip, the
 * copper rule under the current tab is the only colour on it, and the strip
 * scrolls sideways on a phone while the page body never does.
 */
.p-tabs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  min-width: 0;
  border-bottom: 1px solid var(--line);
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}

.p-tabs::-webkit-scrollbar { display: none; }

.p-tab {
  height: 40px;
  padding: 0 12px;
  color: var(--muted);
  font-size: var(--text-label);
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  text-decoration: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color var(--dur-fast) var(--ease-standard);
}

.p-tab:hover { color: var(--ink); }

.p-tab.on {
  color: var(--ink);
  font-weight: 600;
  border-bottom-color: var(--accent);
}

@media (max-width: 1023px) {
  .p-tab { height: 46px; padding: 0 14px; font-size: var(--text-body); }
}
</style>
