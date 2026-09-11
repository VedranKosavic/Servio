<script setup lang="ts">
/**
 * The screens of *Meni i postavke*, as one strip of chips.
 *
 * The left nav has one item for all of them ("Meni i postavke"), so this is what
 * actually moves the owner between the catalogue, the staff, the phones and the
 * thresholds. On a phone the strip scrolls sideways inside its own box; the page
 * body never does — but a strip that has to scroll is already one the owner
 * cannot read at a glance, which is why it is six and not eight.
 *
 * **Two left.** *Stolovi* is the floor plan, and a café's 27 tables are drawn
 * once and then never touched again; the page is still there at
 * `/admin/postavke/stolovi` for the day a wall moves. *Šabloni* was never a menu
 * screen at all — the two shift templates exist so *Raspored* has something to
 * build a week out of, so it moved to the screen that uses it.
 *
 * The order is how often the owner opens them, not how the code is arranged:
 * the menu and its categories are a weekly job, staff and phones a monthly one,
 * and the thresholds and *Pravila* are set once.
 */
const route = useRoute()

const tabs = [
  { to: '/admin/meni', label: 'Meni' },
  { to: '/admin/postavke/kategorije', label: 'Kategorije' },
  { to: '/admin/postavke/osoblje', label: 'Osoblje' },
  { to: '/admin/postavke/uredaji', label: 'Uređaji' },
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

  /* The same edge shading `RobaTabs` uses, and for the same reason: eight tabs
     on a 390 px phone are cut mid-word, and a silent cut reads as broken layout.
     The covers are attached `local` and slide off with the content; the shadows
     are attached `scroll` and stay on the box — so a real end is clean and a cut
     one is shaded, with no JavaScript. */
  background:
    linear-gradient(to right, var(--bg), transparent) left center / 24px 100% no-repeat local,
    linear-gradient(to left, var(--bg), transparent) right center / 24px 100% no-repeat local,
    linear-gradient(to right, var(--line), transparent) left center / 16px 100% no-repeat scroll,
    linear-gradient(to left, var(--line), transparent) right center / 16px 100% no-repeat scroll;
}

.p-tabs::-webkit-scrollbar { display: none; }

.p-tab {
  /* `--tap`: a tab is a navigation target and the floor is 44 px on the
     dashboard at any width, not only below the breakpoint. */
  height: var(--tap);
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
  /* Body size on a phone; the height already comes from `--tap`. */
  .p-tab { padding: 0 14px; font-size: var(--text-body); }
}
</style>
