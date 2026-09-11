<script setup lang="ts">
/**
 * *Smjene* as a list, for the phone.
 *
 * The laptop draws one `UiCard` + `UiTable`, which is the right shape at a desk
 * and a sideways drag in a hand. So here the nights are a card of rows under a
 * **sticky head that carries the period's total** — the same shape *Meni* and
 * *Osoblje* use for their group heads, with one addition that matters on this
 * screen: the owner's question is "how did the nights go", and the answer to it
 * is a single number that must not scroll away after four rows.
 *
 * The head sits on `--bg`, the page's own ground and opaque, so the card passes
 * cleanly underneath it. `top: 0` is the top of the viewport — the dashboard's
 * phone layout puts its tab bar at the **bottom**, so there is nothing up there
 * to sit under.
 *
 * Nothing here is wider than the screen, so the page body never scrolls
 * sideways.
 */
import type { OwnerShiftRow } from '#shared/types'

defineProps<{
  /** The nights in the period, newest first — the server's own order. */
  rows: OwnerShiftRow[]
  /** The first read has not landed: draw bars, not an empty screen. */
  loading: boolean
  /** What the rows add up to, in feninga. The page computes it, not this. */
  total: number
}>()
</script>

<template>
  <div class="s-list">
    <h2 class="s-head">
      <span class="s-head-name">Smjene</span>
      <span class="s-head-n num">{{ rows.length }}</span>
      <span class="s-head-total">
        <span class="s-head-label">Ukupno</span>
        <UiMoney class="s-head-value" :fen="total" :colour="false" />
      </span>
    </h2>

    <!-- Bars, not a spinner over stale takings — the same shape `UiTable` draws. -->
    <div v-if="loading" class="s-card" aria-hidden="true">
      <div v-for="n in 4" :key="n" class="s-skel-row">
        <span class="s-skel-bar wide" />
        <span class="s-skel-bar" />
      </div>
    </div>

    <div v-else-if="rows.length" class="s-card">
      <SmjenaNightRow v-for="row in rows" :key="row.id" :row="row" />
    </div>

    <p v-else class="s-empty">U ovom periodu nema nijedne smjene.</p>
  </div>
</template>

<style scoped>
.s-list { display: flex; flex-direction: column; gap: 6px; min-width: 0; }

.s-head {
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

.s-head-n { font-size: var(--text-label); font-weight: 500; color: var(--muted); }

.s-head-total {
  margin-left: auto;
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
}

.s-head-label {
  font-size: var(--text-caption);
  letter-spacing: 0.09em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--muted);
}

/* The period's total in the sans face, not the display one: it is a column of
   digits that has to stay tabular (DESIGN §1), and Bricolage is the face for
   words. */
.s-head-value {
  font-size: var(--text-section);
  font-weight: 700;
  color: var(--ink);
}

.s-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  overflow: hidden;
  min-width: 0;
}

.s-skel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 16px;
  border-bottom: 1px solid var(--line-soft);
}

.s-skel-row:last-child { border-bottom: 0; }

.s-skel-bar {
  display: block;
  height: 10px;
  width: 84px;
  border-radius: var(--radius-chip);
  background: var(--surface-2);
}

.s-skel-bar.wide { width: 45%; }

.s-empty {
  margin: 0;
  padding: 22px 16px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-card);
  color: var(--muted);
  font-size: var(--text-body);
  text-align: center;
}
</style>
