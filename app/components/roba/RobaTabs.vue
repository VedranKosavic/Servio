<script setup lang="ts">
/**
 * The head of every *Roba* page: the title, the quiet second line, and the six
 * tabs from the mockup.
 *
 * The tabs are `NuxtLink`s and not a `v-model` segment, because each one is its
 * own page with its own URL — a period the owner picked on *Kategorije* stays in
 * that page's query, and a tab he leaves open reloads onto the same tab.
 *
 * A sub-page (an article's ledger, one count, *Početno stanje*) has no tab of its
 * own and lights up the tab it belongs under, so the strip never goes blank.
 */
interface Tab {
  to: string
  label: string
  /** Sub-pages that light this tab up. Matched as path prefixes. */
  owns?: string[]
}

const TABS: Tab[] = [
  { to: '/admin/roba', label: 'Stanje šanka', owns: ['/admin/roba/artikal', '/admin/roba/pocetno-stanje'] },
  { to: '/admin/roba/prijem', label: 'Prijem robe' },
  { to: '/admin/roba/popisi', label: 'Popisi' },
  { to: '/admin/roba/otpis', label: 'Otpis' },
  { to: '/admin/roba/nargila', label: 'Nargila' },
  { to: '/admin/roba/kategorije', label: 'Kategorije' },
]

defineProps<{
  /** The line under the title: "stanje šanka · sub 12.09. 09:05". */
  sub?: string
}>()

const route = useRoute()

function isActive(tab: Tab): boolean {
  if (tab.to === '/admin/roba') {
    return route.path === '/admin/roba'
      || (tab.owns ?? []).some(prefix => route.path.startsWith(prefix))
  }
  return route.path.startsWith(tab.to)
}
</script>

<template>
  <header class="a-roba-head">
    <UiPageHead eyebrow="Lokal" title="Roba" :sub="sub">
      <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    </UiPageHead>

    <nav class="a-roba-tabs" aria-label="Roba">
      <NuxtLink
        v-for="tab in TABS"
        :key="tab.to"
        :to="tab.to"
        class="a-roba-tab"
        :class="{ on: isActive(tab) }"
        :aria-current="isActive(tab) ? 'page' : undefined"
      >{{ tab.label }}</NuxtLink>
    </nav>
  </header>
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
.a-roba-head { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

.a-roba-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--line);
  max-width: 100%;
  /* Six labels do not fit on a phone; the strip scrolls rather than wrapping
     into two rows that push the page's first card off the screen. */
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}

.a-roba-tabs::-webkit-scrollbar { display: none; }

.a-roba-tab {
  height: 40px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  font-size: var(--text-label);
  font-weight: 500;
  color: var(--muted);
  text-decoration: none;
  white-space: nowrap;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color var(--dur-fast) var(--ease-standard);
}

.a-roba-tab:hover { color: var(--ink); }

.a-roba-tab.on {
  color: var(--ink);
  font-weight: 600;
  border-bottom-color: var(--accent);
}

@media (max-width: 1023px) {
  /* A thumb's target — 44 px, like every other control below the breakpoint. */
  .a-roba-tab { height: 46px; font-size: var(--text-body); padding: 0 14px; }
}
</style>
