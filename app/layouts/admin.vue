<script setup lang="ts">
/**
 * The owner dashboard's shell: the light theme, the left nav on a laptop and the
 * bottom tabs on a phone.
 *
 * **`/a` is light and `/k` is dark, and the two never share a rule.** Every
 * token below is defined under `[data-theme='light']`, never on `:root`, so the
 * waiter's dark theme in `app/assets/css/main.css` is untouched and cannot shift
 * by a pixel. Nothing under `/a` writes a hex value; nothing outside `/a` reads
 * these names.
 *
 * `useHead` puts the attribute on `<html>` rather than only on the div below,
 * because the browser paints the page background from the root element — without
 * it the light page would sit on a dark strip when the list overscrolls.
 * `useHead` is scoped to this component, so leaving `/a` takes it away again.
 *
 * One breakpoint, 1024 px: above it the 220 px nav from the mockup, below it
 * four bottom tabs, with *Više* holding the three pages that do not fit.
 */
const me = useMe()
const route = useRoute()
const changes = useAdminChanges()

useHead({
  htmlAttrs: { 'data-theme': 'light' },
  link: [{
    // Bricolage Grotesque, for the wordmark and page titles only. IBM Plex Sans
    // is already loaded app-wide in `nuxt.config.ts`.
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&display=swap',
  }],
  meta: [{ name: 'theme-color', content: '#1f2a2e' }],
})

interface NavItem {
  to: string
  label: string
  icon: 'pulse' | 'money' | 'box' | 'users' | 'list' | 'calendar'
  /** Shown in the bottom tab bar as well as in the left nav. */
  tab?: boolean
  badge?: () => number
  dot?: () => boolean
}

const items: NavItem[] = [
  { to: '/a', label: 'Puls', icon: 'pulse', tab: true, badge: () => changes.attentionCount.value },
  { to: '/a/smjene', label: 'Smjena', icon: 'money', tab: true },
  { to: '/a/roba', label: 'Roba', icon: 'box', tab: true },
  { to: '/a/postavke', label: 'Meni i postavke', icon: 'users' },
  { to: '/a/dnevnik', label: 'Dnevnik', icon: 'list', dot: () => changes.logUnread.value },
  { to: '/a/izvoz', label: 'Izvoz', icon: 'calendar' },
]

/** The three pages the phone hides behind *Više*. */
const moreItems = computed(() => items.filter(item => !item.tab))

function isActive(to: string): boolean {
  // `/a` is the exact page; everything else owns its whole subtree.
  return to === '/a' ? route.path === '/a' : route.path.startsWith(to)
}

/** *Više* is active for any of its children, and carries their badges as one dot. */
const moreActive = computed(() =>
  route.path === '/a/vise' || moreItems.value.some(item => isActive(item.to)))

const moreDot = computed(() => moreItems.value.some(item => item.dot?.() ?? false))

async function signOut() {
  await me.logout()
  await navigateTo('/a/login')
}
</script>

<template>
  <div class="admin" data-theme="light">
    <!-- The laptop nav. Hidden below 1024 px, where the tab bar takes over. -->
    <nav class="a-nav" aria-label="Glavna navigacija">
      <NuxtLink to="/a" class="a-brand">
        Šank
        <small>Kontrolna ploča</small>
      </NuxtLink>

      <NuxtLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        class="a-nav-item"
        :class="{ on: isActive(item.to) }"
        :aria-current="isActive(item.to) ? 'page' : undefined"
      >
        <UiIcon :name="item.icon" />
        <span>{{ item.label }}</span>
        <span v-if="item.badge?.()" class="a-n">{{ item.badge() }}</span>
        <span v-else-if="item.dot?.()" class="a-n a-n-dot" aria-label="novo" />
      </NuxtLink>

      <div class="a-nav-foot">
        <div class="a-venue">{{ me.venue.value?.name ?? 'Lounge' }}</div>
        <div class="a-who">
          <span>{{ me.user.value?.name ?? '' }} · vlasnik</span>
          <button type="button" class="a-signout" @click="signOut">Odjavi se</button>
        </div>
        <p v-if="!changes.ok.value" class="a-offline">Nema veze sa serverom</p>
      </div>
    </nav>

    <main class="a-main">
      <slot />
    </main>

    <!-- The phone tabs. Hidden at 1024 px and above. -->
    <nav class="a-tabs" aria-label="Glavna navigacija">
      <NuxtLink
        v-for="item in items.filter(i => i.tab)"
        :key="item.to"
        :to="item.to"
        class="a-tab"
        :class="{ on: isActive(item.to) }"
        :aria-current="isActive(item.to) ? 'page' : undefined"
      >
        <span class="a-tab-icon">
          <UiIcon :name="item.icon" />
          <span v-if="item.badge?.()" class="a-n a-n-float">{{ item.badge() }}</span>
        </span>
        <span class="a-tab-label">{{ item.label }}</span>
      </NuxtLink>

      <NuxtLink
        to="/a/vise"
        class="a-tab"
        :class="{ on: moreActive }"
        :aria-current="moreActive ? 'page' : undefined"
      >
        <span class="a-tab-icon">
          <UiIcon name="more" />
          <span v-if="moreDot" class="a-n a-n-float a-n-dot" aria-label="novo" />
        </span>
        <span class="a-tab-label">Više</span>
      </NuxtLink>
    </nav>
  </div>
</template>

<style>
/* The palette and the two root rules — see the file for why it is a file. */
@import "~/assets/css/admin.css";
</style>

<style scoped>
.admin {
  min-height: 100dvh;
  display: flex;
  background: var(--bg);
  color: var(--ink);
}

/* ---- the laptop nav ---------------------------------------------------- */

.a-nav {
  width: 220px;
  flex-shrink: 0;
  background: var(--nav);
  color: var(--nav-ink);
  display: flex;
  flex-direction: column;
  padding: 20px 12px;
  gap: 4px;
  /* `align-self: flex-start` is what makes `sticky` work here: without it the
     flex row stretches the nav to the full height of a long page, and an
     element that is already as tall as its container has nothing to stick to. */
  align-self: flex-start;
  position: sticky;
  top: 0;
  height: 100dvh;
}

.a-brand {
  font-family: var(--font-title);
  font-weight: 800;
  font-size: 30px;
  letter-spacing: -0.02em;
  padding: 4px 12px 18px;
  color: var(--on-accent);
  text-decoration: none;
}

.a-brand small {
  display: block;
  font-family: "IBM Plex Sans", system-ui, sans-serif;
  font-weight: 500;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--nav-muted);
  margin-top: 2px;
}

.a-nav-item {
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  color: var(--nav-item);
  font-weight: 500;
  text-decoration: none;
}

.a-nav-item:hover { color: var(--nav-ink); }
.a-nav-item.on { background: var(--accent); color: var(--on-accent); font-weight: 600; }

.a-n {
  margin-left: auto;
  min-width: 22px;
  height: 22px;
  border-radius: 11px;
  background: var(--danger);
  color: var(--on-accent);
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  font-variant-numeric: tabular-nums;
}

.a-n-dot { min-width: 10px; width: 10px; height: 10px; padding: 0; }

.a-nav-foot {
  margin-top: auto;
  padding: 12px 4px 4px;
  font-size: 12px;
  color: var(--nav-muted);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.a-venue {
  height: 40px;
  border-radius: 10px;
  background: var(--nav-well);
  display: flex;
  align-items: center;
  padding: 0 12px;
  color: var(--nav-ink);
  font-weight: 600;
  font-size: 13px;
}

.a-who { display: flex; align-items: center; gap: 8px; padding: 0 4px; }
.a-who span { flex-grow: 1; min-width: 0; }

.a-signout {
  border: 0;
  background: transparent;
  color: var(--nav-ink);
  font: inherit;
  font-size: 12px;
  text-decoration: underline;
  cursor: pointer;
  padding: 4px;
}

.a-offline { margin: 0; padding: 0 4px; color: var(--offline-ink); }

/* ---- the page ---------------------------------------------------------- */

.a-main {
  flex-grow: 1;
  min-width: 0;
  padding: 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* ---- the phone tabs ---------------------------------------------------- */

.a-tabs { display: none; }

@media (max-width: 1023px) {
  .admin { flex-direction: column; }
  .a-nav { display: none; }

  .a-main {
    padding: 16px 14px;
    /* 56 px of tab bar plus the home indicator, so nothing hides under it. */
    padding-bottom: calc(72px + env(safe-area-inset-bottom));
  }

  .a-tabs {
    display: flex;
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    height: 56px;
    padding-bottom: env(safe-area-inset-bottom);
    background: var(--nav);
    z-index: 20;
  }

  .a-tab {
    flex: 1;
    min-height: 56px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    color: var(--nav-muted);
    text-decoration: none;
    font-size: 11px;
    font-weight: 600;
  }

  .a-tab.on { color: var(--accent-soft); }
  .a-tab-icon { position: relative; display: flex; }

  .a-n-float {
    position: absolute;
    top: -6px;
    right: -10px;
    margin-left: 0;
  }
}
</style>
