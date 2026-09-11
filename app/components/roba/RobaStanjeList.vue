<script setup lang="ts">
/**
 * *Stanje šanka* as a list, for the phone.
 *
 * The laptop gets a six-column `UiTable` and should: twenty articles compared
 * across quantity, packs, value and status at one glance is what a desk is for.
 * In a hand that table is a 390 px box the owner drags sideways past the name to
 * reach a status he cannot see — so below 1024 px the row stops being a table
 * row and becomes the one thing this screen is about: **an article and how much
 * of it there is.**
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
 * is what makes the three that are not carry. Everything else an article has —
 * what it is worth, how many packs that is, what last moved it, where its ledger
 * is — is one tap behind the name, in `RobaStanjeSheet`, because on this screen
 * it is read once a week and the quantity is read every night.
 */
import type { StanjeRow } from './RobaStanjeTable.vue'

defineProps<{
  rows: StanjeRow[]
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

    <div v-else-if="rows.length > 0" class="r-card">
      <button
        v-for="row in rows"
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

    <p v-else class="r-empty">Nema robe za ovaj filter.</p>
  </div>
</template>

<style scoped>
.r-list { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

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

.r-empty {
  margin: 0;
  padding: 22px 16px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-card);
  color: var(--muted);
  font-size: var(--text-body);
  text-align: center;
}
</style>
