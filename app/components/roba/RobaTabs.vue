<script setup lang="ts">
/**
 * The head of every *Roba* page: the title, the quiet second line, and the two
 * tabs the owner actually opens.
 *
 * **It used to carry six.** *Popisi*, *Otpis*, *Nargila* and *Kategorije* were
 * each a screen of their own, and between them they made the strip wider than a
 * phone — which is how a six-tab bar teaches somebody to stop reading it. They
 * are gone by the owner's call, with their pages: what a night does to the shelf
 * is on *Stanje šanka*, and what arrives on it is on *Prijem robe*. Nothing on
 * the backend went with them — a waiter still logs otpis and a bartender still
 * counts, from `/konobar` and `/sanker`, which is where those two jobs actually
 * happen.
 *
 * The tabs are `NuxtLink`s and not a `v-model` segment, because each one is its
 * own page with its own URL — a tab the owner leaves open reloads onto the same
 * tab.
 *
 * A sub-page (an article's ledger, one count, *Početno stanje*) has no tab of
 * its own and lights up the tab it belongs under, so the strip never goes blank.
 * Its way back is `UiPageHead`'s, which climbs to the nearest real page.
 */
interface Tab {
  to: string
  label: string
  /** Sub-pages that light this tab up. Matched as path prefixes. */
  owns?: string[]
}

const TABS: Tab[] = [
  {
    to: '/admin/roba',
    label: 'Stanje šanka',
    // `/admin/roba/popisi/<id>` is here because the count a *Smjena* links to
    // still opens, and the shelf is what it is about — the *Popisi* list it used
    // to belong under is gone.
    owns: ['/admin/roba/artikal', '/admin/roba/pocetno-stanje', '/admin/roba/popisi'],
  },
  { to: '/admin/roba/prijem', label: 'Prijem robe' },
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
 * than designed. Both are now an underlined bar: the row reads as one strip and
 * the copper rule under the current tab is the only colour on it.
 *
 * **The sideways scroller is gone with the four tabs.** Six labels did not fit
 * on a 390 px screen, so the strip used to scroll and shade its cut edge with
 * two pairs of gradients. Two labels fit with room to spare, and a scroller
 * around content that never overflows is a scroller that only ever gets in the
 * way of a thumb swiping the page.
 */
.a-roba-head { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

.a-roba-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--line);
  max-width: 100%;
  min-width: 0;
}

.a-roba-tab {
  /* `--tap`: a tab is a navigation target and the floor is 44 px on the
     dashboard at any width, not only below the breakpoint. */
  height: var(--tap);
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
  /* Body size on a phone; the height already comes from `--tap`. */
  .a-roba-tab { font-size: var(--text-body); padding: 0 14px; }
}
</style>
