<script setup lang="ts">
/**
 * The three screens of *Meni i postavke*, as one strip.
 *
 * It was eight chips and is now three. *Podešavanja*, *Pravila*, *Stolovi* and
 * *Šabloni* were deleted outright on the owner's call; *Uređaji* is the one
 * survivor that is not here, and that is deliberate rather than an oversight —
 * see below.
 *
 * **Uređaji has no chip but still has its URL.** The owner asked for the tab
 * gone, and the tab is gone. The page is not, because
 * `/admin/postavke/uredaji` is the only screen in the app that mints a device
 * enrolment code, and a phone cannot sign in until somebody does: the pad asks
 * for a PIN, the PIN needs a device cookie, and the cookie needs a code from
 * this screen. Deleting the page would mean no phone could ever be added to the
 * café — including the first one, on the day this is installed. So the route
 * stays reachable by typing it, and this comment is the note to whoever wonders
 * why it is not in the strip.
 *
 * The order is how often the owner opens them.
 */
const route = useRoute()

const tabs = [
  { to: '/admin/meni', label: 'Meni' },
  { to: '/admin/postavke/kategorije', label: 'Kategorije' },
  { to: '/admin/postavke/osoblje', label: 'Osoblje' },
]

// Exact match, not `startsWith`: a tab lights up for its own screen only.
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
