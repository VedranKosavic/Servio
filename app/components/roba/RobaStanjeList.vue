<script setup lang="ts">
/**
 * *Stanje šanka* as a list, for the phone — and the phone is 99 % of how this
 * dashboard is read.
 *
 * The laptop gets a `UiTable` per section and should: articles compared across
 * quantity, packs, value and status at one glance is what a desk is for. In a
 * hand that table is a 390 px box the owner drags sideways past the name to
 * reach a status he cannot see — so below 1024 px the row stops being a table
 * row and becomes the one thing this screen is about: **an article and how much
 * of it there is.**
 *
 * **Three sections, not one list of nineteen.** *Kafa*, *Nargila* and *Ostalo*,
 * each a sticky label over a card of rows: the label holds the top of the screen
 * for as long as its own articles are on it and the next one pushes it off, so
 * the owner always knows which part of the shelf the number under his thumb
 * belongs to. It is the same shape *Meni* uses for its categories on a phone,
 * because it is the same problem. Which article is in which section is
 * `stanjeGroup()` in `RobaStanjeTable.vue`, read off the article's own `kind` and
 * menu category.
 *
 * **Two numbers, and the second one is red.** The big figure is the *settled*
 * amount — the shelf as the last closed shift left it, which is the number that
 * holds still while somebody reads it. Beside it, in `--danger`, is what
 * tonight's open shift has taken off so far: `48 kom` and `−3`. It appears only
 * when it is not zero, so a quiet afternoon draws one number per row and no
 * colour at all, and it disappears by itself when the shift closes — the
 * quantity is then simply inside the settled figure. Nothing is posted by that
 * moment; the ledger has said the same thing all along (`docs/BACKEND.md` §6.8).
 *
 * **The state is a mark, not a column.** A row that is `ok` says nothing, which
 * is what makes the two that are not carry. Everything else an article has —
 * what it is worth, how many packs that is, what last moved it, where its ledger
 * is — is one tap behind the name, in `RobaStanjeSheet`, because on this screen
 * it is read once a week and the quantity is read every night.
 */
import type { StanjeRow, StanjeSection } from './RobaStanjeTable.vue'

defineProps<{
  sections: StanjeSection[]
  /** The first read has not landed: draw bars, not an empty screen. */
  loading?: boolean
}>()

const emit = defineEmits<{ open: [row: StanjeRow] }>()

/** The pill's word and colour. Colour never carries the meaning by itself. */
function mark(row: StanjeRow): { tone: 'warn' | 'bad', text: string } | null {
  switch (row.status) {
    case 'u_minusu': return { tone: 'bad', text: 'u minusu' }
    case 'bez_cijene': return { tone: 'warn', text: 'bez cijene' }
    case 'nisko': return { tone: 'warn', text: 'nisko' }
    default: return null
  }
}
</script>

<template>
  <div class="r-list">
    <div v-if="loading" class="r-card r-skel" aria-hidden="true">
      <div v-for="n in 6" :key="n" class="r-skel-row">
        <span class="r-skel-bar wide" />
        <span class="r-skel-bar" />
      </div>
    </div>

    <section v-for="section in loading ? [] : sections" :key="section.key" class="r-group">
      <h2 class="r-group-head">
        <span class="r-group-name">{{ section.label }}</span>
        <span class="r-group-n num">{{ section.rows.length }}</span>
      </h2>

      <div class="r-card">
        <button
          v-for="row in section.rows"
          :key="row.id"
          type="button"
          class="r-row"
          :aria-label="`Detalji, ${row.name}`"
          @click="emit('open', row)"
        >
          <span class="r-text">
            <span class="r-name">{{ row.name }}</span>
            <span v-if="mark(row)" class="r-mark">
              <UiPill :tone="mark(row)!.tone">{{ mark(row)!.text }}</UiPill>
            </span>
          </span>

          <span class="r-qty">
            <span class="r-settled num">{{ formatStockQty(row.settled, row.base_unit) }}</span>
            <span v-if="row.pending !== 0" class="r-pending num">
              {{ formatMovementQty(row.pending, row.base_unit) }}
            </span>
          </span>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.r-list { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

.r-group { display: flex; flex-direction: column; gap: 6px; min-width: 0; }

/**
 * The one sticky thing on the screen.
 *
 * It sits on `--bg` — the page's own ground, opaque — so the card of rows passes
 * cleanly underneath it, and it is only as wide as the card, so nothing shows
 * around its edges. `top: 0` is the top of the viewport: the dashboard's phone
 * layout puts its tab bar at the **bottom**, so there is nothing up there to sit
 * under. The same block `PostavkeMeniList` uses for a category.
 */
.r-group-head {
  position: sticky;
  top: 0;
  z-index: 2;
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 10px 2px 7px;
  background: var(--bg);
  font-size: var(--text-section);
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--ink);
}

.r-group-n { font-size: var(--text-label); font-weight: 500; color: var(--muted); }

.r-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  overflow: hidden;
  min-width: 0;
}

/**
 * The whole row is the target.
 *
 * A chevron button on the right would be a 44 px control next to a number that
 * needs the width, to do a job the row can do for free — and the row is a far
 * bigger target than the chevron ever was.
 */
.r-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px 10px;
  width: 100%;
  min-height: var(--tap);
  padding: 10px 14px;
  border: 0;
  border-bottom: 1px solid var(--line-soft);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}

.r-row:last-child { border-bottom: 0; }
.r-row:active { background: var(--bg); }
.r-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

.r-text { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 0; }

.r-name {
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--ink);
  line-height: 1.3;
}

.r-mark { display: flex; align-items: center; gap: 6px; min-width: 0; }

/* The two figures on one baseline: the shelf, then tonight. Never wrapped —
   "48 kom" above "−3" reads as two unrelated facts, and it is one. */
.r-qty {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-shrink: 0;
  white-space: nowrap;
}

.r-settled { font-size: var(--text-section); font-weight: 600; color: var(--ink); }

/* Tonight. The sentence under the card says what the colour means, once —
   a colour never carries a meaning alone (DESIGN §2). */
.r-pending { font-size: var(--text-body); font-weight: 600; color: var(--danger); }

/* Bars, not a spinner over stale numbers — the shape `UiTable` draws. */
.r-skel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 14px;
  border-bottom: 1px solid var(--line-soft);
}

.r-skel-row:last-child { border-bottom: 0; }

.r-skel-bar {
  display: block;
  height: 10px;
  width: 64px;
  border-radius: var(--radius-chip);
  background: var(--surface-2);
}

.r-skel-bar.wide { width: 45%; }
</style>
