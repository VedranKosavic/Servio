<script setup lang="ts">
/**
 * The bartender's whole navigation: three tabs, always in reach of a thumb.
 *
 * It used to be three copper pills, one of them filled — which put the app's one
 * reserved colour, the colour of *Gotovo*, on a piece of furniture that is never
 * the thing to tap. The tabs are now icon-over-label at 56 px, ink against
 * muted, and the current one is marked by a 2 px copper rule above it: "you are
 * here" said with a line rather than with a slab.
 *
 * `sticky bottom-0` keeps the bar on screen while the ticket list scrolls; the
 * negative margin lets it run edge to edge inside the layout's `px-4` column,
 * and its bottom padding clears an iPhone's home indicator.
 */
defineProps<{ active: 'narudzbe' | 'cekanje' | 'stanje' }>()

const TABS = [
  { id: 'narudzbe', to: '/sanker', label: 'Narudžbe' },
  { id: 'cekanje', to: '/sanker/cekanje', label: 'Na čekanju' },
  { id: 'stanje', to: '/stanje', label: 'Stanje šanka' },
] as const
</script>

<template>
  <nav class="nv" aria-label="Glavna navigacija">
    <NuxtLink
      v-for="tab in TABS"
      :key="tab.id"
      :to="tab.to"
      class="nv-tab"
      :class="{ on: active === tab.id }"
      :aria-current="active === tab.id ? 'page' : undefined"
    >
      <span class="nv-mark" aria-hidden="true" />

      <svg
        width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      >
        <!-- narudžbe: a ticket -->
        <template v-if="tab.id === 'narudzbe'">
          <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5V19l-2.7-1.5L14.6 19l-2.6-1.5L9.4 19l-2.7-1.5L4 19z" />
          <path d="M8 9.5h8M8 13h5" />
        </template>
        <!-- na čekanju: a clock -->
        <template v-else-if="tab.id === 'cekanje'">
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 1.8" />
        </template>
        <!-- stanje šanka: bottles on a shelf -->
        <template v-else>
          <path d="M4 20h16" />
          <path d="M7.5 20v-7.2c0-.8.3-1.5.9-2l.6-.6V4h2v6.2l.6.6c.6.5.9 1.2.9 2V20" />
          <path d="M16 20v-6.5a2 2 0 0 1 .8-1.6l.4-.3V7h1.6v4.6l.4.3a2 2 0 0 1 .8 1.6V20" />
        </template>
      </svg>

      <span class="nv-label">{{ tab.label }}</span>
    </NuxtLink>
  </nav>
</template>

<style scoped>
.nv {
  position: sticky;
  bottom: 0;
  z-index: 30;
  display: flex;
  margin: 8px -16px 0;
  padding: 0 8px calc(8px + env(safe-area-inset-bottom));
  background: var(--bg);
  border-top: 1px solid var(--line-soft);
}

.nv-tab {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 56px;
  padding: 8px 4px;
  color: var(--muted);
  text-decoration: none;
  transition: color var(--dur-fast) var(--ease-standard);
}

.nv-tab.on { color: var(--ink); }

/* The "you are here" rule, sitting on the nav's own top border. */
.nv-mark {
  position: absolute;
  top: -1px;
  left: 14px;
  right: 14px;
  height: 2px;
  border-radius: var(--radius-chip);
  background: transparent;
  transition: background var(--dur-fast) var(--ease-standard);
}

.nv-tab.on .nv-mark { background: var(--accent); }

.nv-label {
  font-size: var(--text-caption);
  letter-spacing: 0.04em;
  font-weight: 600;
  text-align: center;
}
</style>
