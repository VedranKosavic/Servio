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
  { to: '/a/roba', label: 'Stanje šanka', owns: ['/a/roba/artikal', '/a/roba/pocetno-stanje'] },
  { to: '/a/roba/prijem', label: 'Prijem robe' },
  { to: '/a/roba/popisi', label: 'Popisi' },
  { to: '/a/roba/otpis', label: 'Otpis' },
  { to: '/a/roba/nargila', label: 'Nargila' },
  { to: '/a/roba/kategorije', label: 'Kategorije' },
]

defineProps<{
  /** The line under the title: "stanje šanka · sub 12.09. 09:05". */
  sub?: string
}>()

const route = useRoute()

function isActive(tab: Tab): boolean {
  if (tab.to === '/a/roba') {
    return route.path === '/a/roba'
      || (tab.owns ?? []).some(prefix => route.path.startsWith(prefix))
  }
  return route.path.startsWith(tab.to)
}
</script>

<template>
  <header class="a-roba-head">
    <div class="a-roba-title">
      <h1>Roba</h1>
      <p v-if="sub" class="a-roba-sub">{{ sub }}</p>
    </div>

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

    <div v-if="$slots.actions" class="a-roba-actions"><slot name="actions" /></div>
  </header>
</template>

<style scoped>
.a-roba-head {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
}

.a-roba-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }

.a-roba-title h1 {
  font-family: var(--font-title);
  font-weight: 700;
  font-size: 28px;
  letter-spacing: -0.015em;
  margin: 0;
  line-height: 1.1;
}

.a-roba-sub { margin: 0; color: var(--muted); font-size: 14px; }

.a-roba-tabs {
  margin-left: auto;
  display: inline-flex;
  gap: 2px;
  background: var(--surface-2);
  border-radius: 10px;
  padding: 3px;
  max-width: 100%;
  /* Six labels do not fit on a phone; the strip scrolls rather than wrapping
     into two rows that push the page's first card off the screen. */
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.a-roba-tab {
  height: 30px;
  padding: 0 12px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-2);
  text-decoration: none;
  white-space: nowrap;
}

.a-roba-tab.on { background: var(--surface); color: var(--ink); }

.a-roba-actions { display: flex; gap: 8px; align-items: center; }

@media (max-width: 1023px) {
  .a-roba-head { align-items: flex-start; }
  .a-roba-tabs { margin-left: 0; width: 100%; }
  /* A thumb's target — 44 px, like every other control below the breakpoint. */
  .a-roba-tab { height: 44px; font-size: 15px; padding: 0 14px; }
}
</style>
