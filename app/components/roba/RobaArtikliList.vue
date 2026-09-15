<script setup lang="ts">
/**
 * *Artikli zalihe* as a list, for the phone.
 *
 * The same shape as *Osoblje*'s list: the articles the bar stocks now, and the
 * deactivated ones behind one `<details>` fold that says how many it holds. An
 * article is never deleted — its movements are the ledger — so the way off the
 * shelf is *Aktivan* off, and the way back is one tap into the fold.
 *
 * A row is the name, and under it the kind, the unit and the cost; the whole row
 * opens `RobaArtikalSheet`, where every field and the *Aktivan* switch live.
 */
import type { StockItemAdmin } from '#shared/types'

defineProps<{
  items: StockItemAdmin[]
  retired: StockItemAdmin[]
  loading: boolean
}>()

const emit = defineEmits<{ open: [item: StockItemAdmin] }>()

function meta(item: StockItemAdmin): string {
  return `${stockKindLabel(item.kind)} · ${item.base_unit} · ${stockCostText(item)}`
}
</script>

<template>
  <div class="l-list">
    <div v-if="loading" class="l-card" aria-hidden="true">
      <div v-for="n in 4" :key="n" class="l-skel-row">
        <span class="l-skel-bar wide" />
        <span class="l-skel-bar" />
      </div>
    </div>

    <template v-else>
      <section class="l-group">
        <h2 class="l-group-head">
          <span>Aktivni</span>
          <span class="l-group-n num">{{ items.length }}</span>
        </h2>

        <div v-if="items.length" class="l-card">
          <button
            v-for="item in items"
            :key="item.id"
            type="button"
            class="l-row"
            @click="emit('open', item)"
          >
            <span class="l-text">
              <span class="l-name">{{ item.name }}</span>
              <span class="l-meta num">{{ meta(item) }}</span>
            </span>
            <UiIcon class="l-chev" name="chevron-right" :size="20" />
          </button>
        </div>

        <p v-else class="l-empty">Nema aktivnih artikala.</p>
      </section>

      <details v-if="retired.length" class="l-fold">
        <summary class="l-group-head">
          <span>Ugašeni</span>
          <span class="l-group-n num">{{ retired.length }}</span>
          <UiIcon class="l-fold-chev" name="chevron-right" :size="18" />
        </summary>

        <p class="l-note">
          Ne nude se na prijemu ni na popisu, ali njihov promet ostaje. Vrati
          artikal kad ga opet nabavljaš.
        </p>

        <div class="l-card">
          <button
            v-for="item in retired"
            :key="item.id"
            type="button"
            class="l-row off"
            @click="emit('open', item)"
          >
            <span class="l-text">
              <span class="l-name">{{ item.name }}</span>
              <span class="l-meta num">{{ meta(item) }}</span>
            </span>
            <UiIcon class="l-chev" name="chevron-right" :size="20" />
          </button>
        </div>
      </details>
    </template>
  </div>
</template>

<style scoped>
.l-list { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.l-group { display: flex; flex-direction: column; gap: 6px; min-width: 0; }

.l-group-head {
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
  color: var(--ink);
}

.l-group-n { font-size: var(--text-label); font-weight: 500; color: var(--muted); }

.l-fold summary { cursor: pointer; list-style: none; }
.l-fold summary::-webkit-details-marker { display: none; }
.l-fold summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.l-fold .l-card { margin-top: 6px; }

.l-fold-chev {
  align-self: center;
  color: var(--muted);
  transition: transform var(--dur-fast) var(--ease-standard);
}

.l-fold[open] .l-fold-chev { transform: rotate(90deg); }

.l-note { margin: 0 2px 8px; font-size: var(--text-micro); color: var(--muted); }

.l-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  overflow: hidden;
  min-width: 0;
}

.l-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: var(--tap);
  padding: 10px 6px 10px 16px;
  border: 0;
  border-bottom: 1px solid var(--line-soft);
  background: transparent;
  font: inherit;
  color: var(--ink);
  text-align: left;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}

.l-row:last-child { border-bottom: 0; }
.l-row:hover { background: var(--surface-3); }
.l-row:active { background: var(--surface-2); }
.l-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

.l-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }

.l-name {
  font-size: var(--text-body);
  font-weight: 600;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.l-row.off .l-name { color: var(--ink-2); }

.l-meta { font-size: var(--text-micro); color: var(--muted); overflow-wrap: anywhere; }

.l-chev { flex-shrink: 0; color: var(--muted); margin-right: 8px; }

.l-skel-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border-bottom: 1px solid var(--line-soft);
}

.l-skel-row:last-child { border-bottom: 0; }

.l-skel-bar {
  display: block;
  height: 10px;
  width: 96px;
  border-radius: var(--radius-chip);
  background: var(--surface-2);
}

.l-skel-bar.wide { width: 50%; }

.l-empty {
  margin: 0;
  padding: 22px 16px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-card);
  color: var(--muted);
  font-size: var(--text-body);
  text-align: center;
}
</style>
