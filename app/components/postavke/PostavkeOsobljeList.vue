<script setup lang="ts">
/**
 * *Osoblje* as a list, for the phone.
 *
 * **Two lists, and only one of them is open.** `GET /api/admin/users` returns
 * everybody the café has ever had, because nobody is ever deleted — a waiter
 * who left in March is still the actor on every round he locked. Drawn straight
 * onto a phone that is fifteen rows, eight of them retired demo accounts, two
 * of them called *Emir*: the owner had to read a *Stanje* column to know which
 * of two identical names was the person standing in front of him.
 *
 * So the screen is the staff that works here, and the retired ones are a
 * **folded section that says how many it is holding**. They stay one tap away,
 * because bringing somebody back is a real thing the owner does.
 *
 * `<details>` and not a toggle in script, because the browser already knows how
 * to open one, announce it, and find text inside it. The two section heads are
 * sticky on the page's own ground, exactly as the category heads on *Meni* are:
 * fifteen people is two screens of scrolling, and the one thing that must never
 * be in doubt is which of the two lists the name under the thumb belongs to.
 */
import type { UserAdmin } from '#shared/types'

defineProps<{
  /** Active staff, in the server's own order (by name). */
  team: UserAdmin[]
  /** Deactivated, kept for their history. Folded away. */
  retired: UserAdmin[]
  /** The first read has not landed: draw bars, not an empty screen. */
  loading: boolean
  /** The signed-in owner, for the one copper circle. */
  meId: string | null
}>()

const emit = defineEmits<{ open: [user: UserAdmin] }>()
</script>

<template>
  <div class="p-list">
    <div v-if="loading" class="p-card p-skel" aria-hidden="true">
      <div v-for="n in 4" :key="n" class="p-skel-row">
        <span class="p-skel-dot" />
        <span class="p-skel-bar wide" />
        <span class="p-skel-bar" />
      </div>
    </div>

    <template v-else>
      <section class="p-group">
        <h2 class="p-group-head">
          <span class="p-group-name">Aktivni</span>
          <span class="p-group-n num">{{ team.length }}</span>
        </h2>

        <div v-if="team.length" class="p-card">
          <PostavkeOsobljeRow
            v-for="user in team"
            :key="user.id"
            :user="user"
            :is-me="user.id === meId"
            @open="emit('open', user)"
          />
        </div>

        <p v-else class="p-empty">Nema aktivnog osoblja.</p>
      </section>

      <details v-if="retired.length" class="p-fold">
        <summary class="p-group-head">
          <span class="p-group-name">Ugašeni</span>
          <span class="p-group-n num">{{ retired.length }}</span>
          <UiIcon class="p-chev" name="chevron-right" :size="18" />
        </summary>

        <p class="p-note">
          Ne prijavljuju se i ne stoje u rasporedu, ali ostaju na svojim starim
          turama. Ko se vrati, dobija novi PIN.
        </p>

        <div class="p-card">
          <PostavkeOsobljeRow
            v-for="user in retired"
            :key="user.id"
            :user="user"
            :is-me="user.id === meId"
            @open="emit('open', user)"
          />
        </div>
      </details>
    </template>
  </div>
</template>

<style scoped>
.p-list { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

.p-group { display: flex; flex-direction: column; gap: 6px; min-width: 0; }

/**
 * The sticky head, on `--bg` — the page's own ground, opaque — so the card of
 * people passes cleanly underneath it. `top: 0` is the top of the viewport: the
 * dashboard's phone layout puts its tab bar at the bottom, so there is nothing
 * up there to sit under.
 */
.p-group-head {
  position: sticky;
  top: 0;
  z-index: 2;
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-height: var(--tap);
  padding: 10px 2px 7px;
  background: var(--bg);
  font-size: var(--text-section);
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--ink);
}

.p-group-n { font-size: var(--text-label); font-weight: 500; color: var(--muted); }

/* The fold's head is the disclosure, so it is a target and it carries the
   chevron; Safari's own triangle would be a second one.
   `<details>` is left in normal block flow — a `display: flex` on the element
   itself is where a disclosure stops disclosing in one browser or another. */
.p-fold summary { cursor: pointer; list-style: none; }
.p-fold .p-card { margin-top: 6px; }
.p-fold summary::-webkit-details-marker { display: none; }
.p-fold summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

/* Beside the count and not out at the right edge: the dashboard's chat button
   floats in that corner on every screen, and a disclosure the owner cannot see
   is a section he does not know opens. */
.p-chev {
  align-self: center;
  color: var(--muted);
  transition: transform var(--dur-fast) var(--ease-standard);
}

.p-fold[open] .p-chev { transform: rotate(90deg); }

.p-note {
  margin: 0 2px 8px;
  font-size: var(--text-micro);
  color: var(--muted);
}

.p-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  overflow: hidden;
  min-width: 0;
}

/* Bars, not a spinner over stale names — the same shape `UiTable` draws. */
.p-skel-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 16px;
  border-bottom: 1px solid var(--line-soft);
}

.p-skel-row:last-child { border-bottom: 0; }

.p-skel-dot {
  display: block;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-chip);
  background: var(--surface-2);
  flex-shrink: 0;
}

.p-skel-bar {
  display: block;
  height: 10px;
  width: 64px;
  border-radius: var(--radius-chip);
  background: var(--surface-2);
}

.p-skel-bar.wide { width: 40%; }

.p-empty {
  margin: 0;
  padding: 22px 16px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-card);
  color: var(--muted);
  font-size: var(--text-body);
  text-align: center;
}
</style>
