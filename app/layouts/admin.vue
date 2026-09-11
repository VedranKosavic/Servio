<script setup lang="ts">
/**
 * The owner dashboard's shell: the light theme, the left rail on a laptop and
 * the bottom tabs on a phone.
 *
 * **`/admin` is light and `/konobar` is dark, and the two never share a rule.**
 * Every token below is defined under `[data-theme='light']`, never on `:root`,
 * so the waiter's dark theme in `app/assets/css/main.css` is untouched and
 * cannot shift by a pixel. Nothing under `/admin` writes a hex value; nothing
 * outside `/admin` reads these names.
 *
 * `useHead` puts the attribute on `<html>` rather than only on the div below,
 * because the browser paints the page background from the root element — without
 * it the light page would sit on a dark strip when the list overscrolls.
 * `useHead` is scoped to this component, so leaving `/admin` takes it away again.
 *
 * One breakpoint, 1024 px: above it the rail, below it four bottom tabs, with
 * *Više* holding the three pages that do not fit.
 *
 * **The rail is grouped, and the current row is not a copper slab.** Eight flat
 * rows is a list of links; three labelled groups is a product with a shape, and
 * the owner learns where a screen lives instead of reading eight labels every
 * time. The current row used to be filled solid copper, which put the loudest
 * colour in the theme on screen permanently and left nothing louder for the one
 * button a page is about — it is now a raised well with a copper spine and
 * copper ink, which is louder than every other row and quieter than a button.
 */
const me = useMe()
const route = useRoute()
const changes = useAdminChanges()

// Both faces are loaded app-wide in `nuxt.config.ts` (docs/DESIGN.md §1),
// so this only flips the theme and the browser chrome.
useHead({
  htmlAttrs: { 'data-theme': 'light' },
  meta: [{ name: 'theme-color', content: THEME_COLOR_LIGHT }],
})

/**
 * The rows come from `app/utils/adminNav.ts` (WP0) rather than an inline array,
 * so a Phase 4 package adding *Razgovor* edits one file instead of this one and
 * `vise.vue` both. The badges stay here, because they are this shell's state.
 */
const badge: Record<string, () => number> = {
  puls: () => changes.attentionCount.value,
}
/**
 * A row that carries a quiet dot rather than a count.
 *
 * It is empty since *Dnevnik* left the nav, and it stays because the *Više*
 * tab's dot is computed from it — a package that adds a row with news to
 * report adds one line here rather than re-deriving the whole mechanism.
 */
const dot: Record<string, () => boolean> = {}

/**
 * The rail's shape, by row id.
 *
 * The grouping lives here and not in `ADMIN_NAV` on purpose: the rows are the
 * app's, the way this one shell arranges them is the shell's. A package that
 * adds a row and forgets this table gets it in the last group rather than
 * nowhere — an unlisted id falls through to *Podešavanje*.
 */
const GROUPS: Array<{ label: string, ids: string[] }> = [
  { label: 'Lokal', ids: ['puls', 'smjene', 'roba'] },
  { label: 'Ljudi', ids: ['raspored'] },
  { label: 'Podešavanje', ids: ['postavke', 'izvoz'] },
]

const grouped = computed(() => {
  const placed = new Set(GROUPS.flatMap(group => group.ids))
  return GROUPS.map((group, index) => ({
    label: group.label,
    items: ADMIN_NAV.filter(item => index === GROUPS.length - 1
      ? group.ids.includes(item.id) || !placed.has(item.id)
      : group.ids.includes(item.id)),
  })).filter(group => group.items.length)
})

/** The pages the phone hides behind *Više*. */
const moreItems = computed(() => adminMore())

function isActive(to: string): boolean {
  // `/admin` is the exact page; everything else owns its whole subtree.
  return to === '/admin' ? route.path === '/admin' : route.path.startsWith(to)
}

/** *Više* is active for any of its children, and carries their badges as one dot. */
const moreActive = computed(() =>
  route.path === '/admin/vise' || moreItems.value.some(item => isActive(item.to)))

const moreDot = computed(() => moreItems.value.some(item => dot[item.id]?.() ?? false))

/** "HA" — the owner's own initials, in the same circle the rest of the app uses. */
const initials = computed(() => (me.user.value?.name ?? '')
  .split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase())

/**
 * *Odjavi se*, and it ends on the pad like every other sign-out in the app.
 *
 * `me.logout()` already navigates to `/` — the PIN pad — and a second
 * `navigateTo` here used to overwrite that with `/admin/login`, the e-mail
 * door. That is the wrong screen for the phone the owner is actually holding:
 * the pad is where his PIN works, `/admin/login` is the laptop entrance he
 * keeps for the once a year he forgets it, and landing there after every
 * sign-out meant tapping *Nazad* to get to the only door with a keypad.
 * The one landing rule is `shared/landing.ts`, and its start is `/`.
 */
async function signOut() {
  await me.logout()
}
</script>

<template>
  <div class="admin" data-theme="light">
    <!-- The laptop rail. Hidden below 1024 px, where the tab bar takes over. -->
    <nav class="a-nav" aria-label="Glavna navigacija">
      <NuxtLink to="/admin" class="a-brand">
        <!-- The same mark as the lock screen, at a rail's size: one product,
             two rooms. Copper on the rail's own dark, not on paper, so the
             stroke takes `--nav-on-ink` rather than `--accent`. -->
        <svg
          class="a-brand-mark" viewBox="0 0 32 32" width="30" height="30"
          aria-hidden="true" focusable="false"
        >
          <rect
            x="0.75" y="0.75" width="30.5" height="30.5" rx="9.5"
            fill="var(--nav-well)" stroke="var(--nav-line)" stroke-width="1.5"
          />
          <path
            d="M21 11.6a5 5 0 0 0-4.9-2.9c-2.6 0-4.3 1.3-4.3 3.3 0 4.3 9.4 2.5 9.4 6.9 0 2.2-1.9 3.6-4.7 3.6A5.4 5.4 0 0 1 11 19"
            fill="none" stroke="var(--nav-on-ink)" stroke-width="2.1" stroke-linecap="round"
          />
        </svg>
        <span class="a-brand-text">
          <span class="a-brand-name">{{ APP_NAME }}</span>
          <small>{{ APP_TAGLINE }}</small>
        </span>
      </NuxtLink>

      <div class="a-nav-scroll">
        <div v-for="group in grouped" :key="group.label" class="a-nav-group">
          <p class="a-nav-group-label">{{ group.label }}</p>

          <template v-for="item in group.items" :key="item.id">
            <!-- A screen that does not exist yet is greyed out and says so,
                 rather than being absent: a nav that grows an item every week
                 teaches nobody where anything is. -->
            <span v-if="!item.ready" class="a-nav-item a-nav-soon">
              <UiIcon :name="item.icon" :size="20" />
              <span>{{ item.label }}</span>
              <small>{{ item.soon }}</small>
            </span>
            <NuxtLink
              v-else
              :to="item.to"
              class="a-nav-item"
              :class="{ on: isActive(item.to) }"
              :aria-current="isActive(item.to) ? 'page' : undefined"
            >
              <UiIcon :name="item.icon" :size="20" />
              <span>{{ item.label }}</span>
              <span v-if="badge[item.id]?.()" class="a-n">{{ badge[item.id]!() }}</span>
              <span v-else-if="dot[item.id]?.()" class="a-n a-n-dot" aria-label="novo" />
            </NuxtLink>
          </template>
        </div>
      </div>

      <div class="a-nav-foot">
        <!-- Same reason as the line below: the venue's real name only exists on
             the client, so a server-rendered fallback would mismatch it. -->
        <ClientOnly>
          <div class="a-venue">
            <span class="a-venue-eyebrow">Lokal</span>
            <span class="a-venue-name">{{ me.venue.value?.name ?? 'Lounge' }}</span>
          </div>
        </ClientOnly>

        <!-- The owner also serves tables, and stands behind the bar. Both staff
             screens ask for a session and not for a role (`requireSession()`
             with no argument), so these are the two links he needs to cross
             over — and back, from the waiter menu. He never picks a `mode`: an
             admin has none, and his landing is the dashboard either way. -->
        <NuxtLink to="/konobar" class="a-cross">
          <span>Konobarski ekran</span>
          <UiIcon name="chevron-right" :size="18" />
        </NuxtLink>
        <NuxtLink to="/sanker" class="a-cross">
          <span>Šankerski ekran</span>
          <UiIcon name="chevron-right" :size="18" />
        </NuxtLink>

        <p v-if="!changes.ok.value" class="a-offline">Nema veze sa serverom</p>

        <div class="a-who">
          <!-- The session is a httpOnly cookie the client-only `admin` middleware
               resolves, so SSR has no user and the client does. Rendering half
               the sentence on the server is a hydration mismatch on every /admin
               page; ClientOnly keeps the whole line off the server render. -->
          <ClientOnly>
            <span class="a-who-face" aria-hidden="true">{{ initials }}</span>
            <span class="a-who-text">
              <b>{{ me.user.value?.name }}</b>
              <small>vlasnik</small>
            </span>
          </ClientOnly>
          <button type="button" class="a-signout" @click="signOut">Odjavi se</button>
        </div>
      </div>
    </nav>

    <main class="a-main">
      <slot />
    </main>

    <!-- *Razgovor*, as a button in the corner rather than a row in the nav.
         It is mounted on the shell so it survives every route change with its
         thread and its half-typed reply intact. -->
    <ChatDock />

    <!-- The phone tabs. Hidden at 1024 px and above. -->
    <nav class="a-tabs" aria-label="Glavna navigacija">
      <NuxtLink
        v-for="item in adminTabs()"
        :key="item.id"
        :to="item.to"
        class="a-tab"
        :class="{ on: isActive(item.to) }"
        :aria-current="isActive(item.to) ? 'page' : undefined"
      >
        <span class="a-tab-icon">
          <UiIcon :name="item.icon" :size="22" />
          <span v-if="badge[item.id]?.()" class="a-n a-n-float">{{ badge[item.id]!() }}</span>
        </span>
        <span class="a-tab-label">{{ item.label }}</span>
      </NuxtLink>

      <NuxtLink
        to="/admin/vise"
        class="a-tab"
        :class="{ on: moreActive }"
        :aria-current="moreActive ? 'page' : undefined"
      >
        <span class="a-tab-icon">
          <UiIcon name="more" :size="22" />
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

/* ---- the laptop rail --------------------------------------------------- */

.a-nav {
  width: 236px;
  flex-shrink: 0;
  background: var(--nav);
  color: var(--nav-ink);
  display: flex;
  flex-direction: column;
  padding: 20px 12px 16px;
  /* `align-self: flex-start` is what makes `sticky` work here: without it the
     flex row stretches the rail to the full height of a long page, and an
     element that is already as tall as its container has nothing to stick to. */
  align-self: flex-start;
  position: sticky;
  top: 0;
  height: 100dvh;
}

/* ---- the brand lockup -------------------------------------------------- */

.a-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px 20px;
  color: var(--nav-ink);
  text-decoration: none;
  min-width: 0;
}

.a-brand-mark { display: block; flex-shrink: 0; }
.a-brand-text { display: flex; flex-direction: column; min-width: 0; }

.a-brand-name {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: var(--text-title);
  line-height: 1.1;
  letter-spacing: -0.025em;
}

.a-brand small {
  font-size: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--nav-muted);
  margin-top: 3px;
  line-height: 1.2;
}

/* ---- the rows ---------------------------------------------------------- */

/* The groups scroll if a future package adds a tenth row; the brand and the
   foot stay put, so the owner's own name never scrolls off the rail. */
.a-nav-scroll {
  flex-grow: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.a-nav-group { display: flex; flex-direction: column; gap: 2px; }

.a-nav-group-label {
  margin: 0 0 6px;
  padding: 0 12px;
  font-size: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--nav-muted);
}

.a-nav-item {
  position: relative;
  min-height: 44px;
  border-radius: var(--radius-field);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  color: var(--nav-item);
  font-weight: 500;
  font-size: var(--text-label);
  text-decoration: none;
  transition:
    background var(--dur-fast) var(--ease-standard),
    color var(--dur-fast) var(--ease-standard);
}

.a-nav-item > span:first-of-type { flex-grow: 1; min-width: 0; }
.a-nav-item :deep(svg) { flex-shrink: 0; opacity: 0.85; }

.a-nav-item:hover { background: var(--nav-well); color: var(--nav-ink); }

/* A row whose screen has not landed: greyed out and honest, never absent. */
.a-nav-soon { opacity: 0.4; cursor: default; }
.a-nav-soon:hover { background: transparent; color: var(--nav-item); }
/* `nowrap`, or "stiže uskoro" breaks over two lines inside the rail and the row
   grows taller than every other one. */
/* 10 and 11 px live only inside the dark rail, below the scale on purpose: a
   badge's digits, a tab's label and the "soon" note are furniture, not text. */
.a-nav-soon small { font-size: var(--text-caption); white-space: nowrap; flex-shrink: 0; }

/* The current page: a raised well, copper ink, and a copper spine down the
   left edge. Louder than every other row, quieter than a button. */
.a-nav-item.on {
  background: var(--nav-on);
  color: var(--nav-on-ink);
  font-weight: 600;
}

.a-nav-item.on :deep(svg) { opacity: 1; }

.a-nav-item.on::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 20px;
  border-radius: 0 2px 2px 0;
  background: var(--nav-on-ink);
}

.a-n {
  flex-shrink: 0;
  min-width: 20px;
  height: 20px;
  border-radius: var(--radius-chip);
  background: var(--danger);
  color: var(--on-accent);
  font-size: var(--text-caption);
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  font-variant-numeric: tabular-nums;
}

.a-n-dot { min-width: 8px; width: 8px; height: 8px; padding: 0; }

/* ---- the foot ---------------------------------------------------------- */

.a-nav-foot {
  flex-shrink: 0;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--nav-line);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.a-venue {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 8px 12px;
  border-radius: var(--radius-field);
  background: var(--nav-well);
  min-width: 0;
}

.a-venue-eyebrow {
  font-size: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--nav-muted);
}

.a-venue-name {
  color: var(--nav-ink);
  font-weight: 600;
  font-size: var(--text-label);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.a-cross {
  min-height: 44px;
  border-radius: var(--radius-field);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  color: var(--nav-item);
  font-weight: 600;
  font-size: var(--text-micro);
  text-decoration: none;
  transition: background var(--dur-fast) var(--ease-standard);
}

.a-cross span { flex-grow: 1; min-width: 0; }
.a-cross:hover { background: var(--nav-well); color: var(--nav-ink); }

.a-who {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 4px 0;
  min-width: 0;
}

.a-who-face {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-chip);
  background: var(--nav-well);
  color: var(--nav-ink);
  font-family: var(--font-display);
  font-size: var(--text-caption);
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.a-who-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex-grow: 1;
  line-height: 1.25;
}

.a-who-text b {
  font-size: var(--text-micro);
  font-weight: 600;
  color: var(--nav-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.a-who-text small { font-size: var(--text-caption); color: var(--nav-muted); }

/* A real box, not an underlined word: this is on every page of the dashboard
   and it measured 28 px against a 44 px floor. The underline goes with it — the
   rail's rows are not underlined either, and a control that has a shape does not
   need one to say it is a control. */
.a-signout {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  min-height: var(--tap);
  border: 0;
  border-radius: var(--radius-field);
  background: transparent;
  color: var(--nav-muted);
  font: inherit;
  font-size: var(--text-caption);
  cursor: pointer;
  padding: 0 10px;
  transition: background var(--dur-fast) var(--ease-standard);
}

.a-signout:hover { background: var(--nav-well); }

.a-signout:hover { color: var(--nav-ink); }

.a-offline {
  margin: 2px 0;
  padding: 6px 12px;
  border-radius: var(--radius-field);
  background: var(--nav-well);
  color: var(--offline-ink);
  font-size: var(--text-caption);
  font-weight: 600;
}

/* ---- the page ---------------------------------------------------------- */

.a-main {
  flex-grow: 1;
  min-width: 0;
  padding: 28px 32px 48px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* ---- the phone tabs ---------------------------------------------------- */

.a-tabs { display: none; }

@media (max-width: 1023px) {
  .admin { flex-direction: column; }
  .a-nav { display: none; }

  .a-main {
    padding: 20px 16px 0;
    gap: 20px;
    /* 60 px of tab bar plus the home indicator, so nothing hides under it. */
    padding-bottom: calc(76px + env(safe-area-inset-bottom));
  }

  .a-tabs {
    display: flex;
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    height: 60px;
    padding-bottom: env(safe-area-inset-bottom);
    background: var(--nav);
    border-top: 1px solid var(--nav-line);
    z-index: 20;
  }

  .a-tab {
    flex: 1;
    min-height: 60px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    color: var(--nav-muted);
    text-decoration: none;
    font-size: var(--text-caption);
    font-weight: 600;
  }

  .a-tab.on { color: var(--nav-on-ink); }
  .a-tab-icon { position: relative; display: flex; }

  .a-n-float {
    position: absolute;
    top: -6px;
    right: -10px;
    margin-left: 0;
  }
}
</style>
