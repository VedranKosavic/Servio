<script setup lang="ts">
/**
 * *Prodano* — the counter behind a shift card: every article the shift sold, with
 * how many went out and what was charged for them.
 *
 * The owner's ask was a **counter and not a feed**: *"we show all the items counter
 * of the current live state (how much was sold currently in that shift)"*. A
 * shift's lines are three hundred rows on a busy night and answer a different
 * question — what happened at 21:14 — so they are folded by article in
 * `soldRows()` and the biggest seller is the first row.
 *
 * **A list of rows, not a table.** This screen is a phone in ninety-nine cases in
 * a hundred, so it is built the way *Meni* is built for a phone: a row is a name
 * and the two numbers about it, right-aligned and tabular, and nothing scrolls
 * sideways at any width. At a desk the same list simply has more air around it —
 * three columns is not a spreadsheet worth building a second layout for.
 *
 * The marks under a name are the two things a quantity alone does not say: how
 * many went out *na račun kuće*, and how many rounds were cancelled. A cancelled
 * round is **not** a sale, so it is not in the quantity — but leaving it off the
 * screen entirely would mean an article whose only two rounds were stornirana
 * disappeared from a list that is supposed to say what happened.
 */
import type { SoldRow, SoldTotals } from '~/utils/puls'

defineProps<{
  rows: SoldRow[]
  totals: SoldTotals
  loading: boolean
  /** More lines than the page would read: the foot says so rather than lying. */
  truncated?: boolean
}>()
</script>

<template>
  <UiCard title="Prodano" :count="loading ? undefined : `${totals.products} artikala`">
    <div v-if="loading" class="p-skel" aria-hidden="true">
      <div v-for="n in 6" :key="n" class="p-skel-row">
        <span class="p-skel-bar wide" />
        <span class="p-skel-bar" />
      </div>
    </div>

    <template v-else-if="rows.length">
      <div class="p-head">
        <span>Artikal</span>
        <span class="p-r">Kom</span>
        <span class="p-r">Iznos</span>
      </div>

      <div v-for="row in rows" :key="row.name" class="p-row">
        <span class="p-name">
          {{ row.name }}
          <small v-if="row.gratis_qty || row.storno_qty" class="p-mark num">
            {{ [
              row.gratis_qty ? `${row.gratis_qty} gratis` : '',
              row.storno_qty ? `${row.storno_qty} stornirano` : '',
            ].filter(Boolean).join(' · ') }}
          </small>
        </span>
        <span class="p-qty num">{{ row.qty }}</span>
        <span class="p-fen num"><UiMoney :fen="row.fen" :currency="false" :colour="false" /></span>
      </div>

      <div class="p-row p-total">
        <span class="p-name">Ukupno</span>
        <span class="p-qty num">{{ totals.qty }}</span>
        <span class="p-fen num"><UiMoney :fen="totals.fen" :currency="false" :colour="false" /></span>
      </div>

      <p v-if="truncated" class="p-note">
        Smjena ima više stavki nego što ovaj ekran čita odjednom — brojevi su za
        pročitani dio.
      </p>
    </template>

    <p v-else class="p-empty">U ovoj smjeni još nije ništa prodano.</p>
  </UiCard>
</template>

<style scoped>
/**
 * One grid for the header, every row and the total, so the three columns cannot
 * drift apart. The name takes what is left and wraps rather than truncating: on a
 * phone the name is the whole point of the row.
 */
.p-head,
.p-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 48px minmax(64px, auto);
  align-items: baseline;
  gap: 10px;
}

.p-head {
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line);
  font-size: var(--text-caption);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  font-weight: 600;
}

.p-r { text-align: right; }

.p-row {
  padding: 9px 0;
  border-bottom: 1px solid var(--line-soft);
  font-size: var(--text-body);
}

.p-row:last-of-type { border-bottom: 0; }

.p-name {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  color: var(--ink);
  font-weight: 500;
}

/* The two things a quantity does not say, one step down and in the quiet
   colour — a mark, never a column of its own. */
.p-mark {
  font-size: var(--text-micro);
  color: var(--muted);
  font-weight: 400;
}

.p-qty {
  text-align: right;
  font-weight: 700;
  color: var(--ink);
}

.p-fen { text-align: right; color: var(--ink-2); }

/* The foot is the same row one weight up, over a full rule — a total is the same
   kind of thing as the rows above it, read last. */
.p-total {
  border-top: 1px solid var(--line);
  border-bottom: 0;
  padding-top: 11px;
  font-weight: 700;
}

.p-total .p-name, .p-total .p-fen { color: var(--ink); font-weight: 700; }

.p-note {
  margin: 0;
  padding-top: 10px;
  color: var(--muted);
  font-size: var(--text-micro);
}

.p-empty { margin: 0; color: var(--muted); font-size: var(--text-label); }

/* Bars, not a spinner over numbers that are not there yet. */
.p-skel { display: flex; flex-direction: column; }

.p-skel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid var(--line-soft);
}

.p-skel-row:last-child { border-bottom: 0; }

.p-skel-bar {
  display: block;
  height: 10px;
  width: 64px;
  border-radius: var(--radius-chip);
  background: var(--surface-2);
}

.p-skel-bar.wide { width: 45%; }
</style>
