<script setup lang="ts">
/**
 * One article on *Stanje šanka*, opened from its row on a phone.
 *
 * The laptop table has six columns and room for all of them. A 390 px row has
 * room for a name and a quantity, so everything else about the article lives
 * here: what it is worth, how many packs that is, what last moved it, and the
 * way into its ledger.
 *
 * **The split is spelled out here, in full.** On the row it is two figures side
 * by side, which is right for scanning twenty of them; here there is room for
 * the sentence the two figures are a shorthand for — *this is what was on the
 * shelf, this is what tonight took, this is what is there now* — so the screen
 * teaches the red number once, in the one place somebody is reading rather than
 * scanning. The middle line is drawn only while a shift is open and has moved
 * this article; on every other article the sheet shows one quantity, because
 * there is only one.
 *
 * Nothing in here is a control except the way into the article's ledger. A
 * correction lives on that page, behind the *Korekcija* button, and it stays
 * there: writing a movement is not something to be two taps from a list.
 */
import type { StanjeRow } from './RobaStanjeTable.vue'

const props = defineProps<{
  open: boolean
  /** Read fresh by the page every render, so a poll moves the numbers under it. */
  row: StanjeRow | null
}>()

const emit = defineEmits<{ close: [] }>()

/** The pill's word and colour. Colour never carries the meaning by itself. */
const status = computed<{ tone: 'good' | 'warn' | 'bad', text: string } | null>(() => {
  const row = props.row
  if (!row) return null
  switch (row.status) {
    case 'u_minusu': return { tone: 'bad', text: 'u minusu' }
    case 'bez_cijene': return { tone: 'warn', text: 'bez cijene' }
    case 'nisko':
      return { tone: 'warn', text: row.par_qty === null ? 'nisko' : `nisko · minimum ${row.par_qty}` }
    default: return { tone: 'good', text: 'ok' }
  }
})
</script>

<template>
  <UiSheet
    :open="open"
    :title="row?.name ?? 'Artikal'"
    @close="emit('close')"
  >
    <template v-if="row">
      <div class="r-sums">
        <div class="r-sum">
          <span class="r-sum-label">{{ row.pending !== 0 ? 'Stanje prije večeras' : 'Na stanju' }}</span>
          <span class="r-sum-value num">{{ formatStockQty(row.settled, row.base_unit) }}</span>
        </div>

        <div v-if="row.pending !== 0" class="r-sum">
          <span class="r-sum-label">Večerašnja smjena</span>
          <span class="r-sum-value red num">{{ formatMovementQty(row.pending, row.base_unit) }}</span>
        </div>

        <div v-if="row.pending !== 0" class="r-sum">
          <span class="r-sum-label">Sada na polici</span>
          <span class="r-sum-value num">{{ formatStockQty(row.on_hand, row.base_unit) }}</span>
        </div>
      </div>

      <p v-if="row.pending !== 0" class="r-hint">
        Crveni broj ulazi u stanje kad se smjena zatvori. Roba je već skinuta sa
        police — ovdje je samo odvojeno prikazana.
      </p>

      <div class="r-facts">
        <div class="r-fact">
          <span class="r-fact-label">Status</span>
          <span class="r-fact-value">
            <UiPill v-if="status" :tone="status.tone">{{ status.text }}</UiPill>
          </span>
        </div>

        <div class="r-fact">
          <span class="r-fact-label">Vrijednost</span>
          <span class="r-fact-value num"><UiMoney :fen="row.value_fen" /></span>
        </div>

        <div class="r-fact">
          <span class="r-fact-label">Paketi + komadi</span>
          <span class="r-fact-value num">{{ row.packs_label ?? '—' }}</span>
        </div>

        <div v-if="row.last_movement" class="r-fact">
          <span class="r-fact-label">Zadnje kretanje</span>
          <span class="r-fact-value">
            {{ row.last_movement.ref_label }} ·
            <span class="num">{{ dateBs(row.last_movement.occurred_at) }}</span>
          </span>
        </div>

        <div v-if="row.no_recipe || row.late_sync" class="r-fact">
          <span class="r-fact-label">Napomena</span>
          <span class="r-fact-value">
            <UiPill v-if="row.no_recipe" tone="warn">bez normativa</UiPill>
            <UiPill v-if="row.late_sync" tone="warn">kasno sinhronizovano</UiPill>
          </span>
        </div>
      </div>
    </template>

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Zatvori</UiButton>
      <UiButton
        v-if="row"
        variant="primary"
        @click="navigateTo(`/admin/roba/artikal/${row.id}`)"
      >Kretanje robe</UiButton>
    </template>
  </UiSheet>
</template>

<style scoped>
/* The numbers first, on their own, because they are what the sheet was opened
   for. One step down the ladder from the page title, one step up from a row. */
.r-sums { display: flex; flex-direction: column; gap: 2px; }

.r-sum {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  min-height: 34px;
}

.r-sum-label { font-size: var(--text-label); color: var(--muted); }

.r-sum-value {
  font-family: var(--font-display);
  font-size: var(--text-section);
  font-weight: 700;
  color: var(--ink);
}

.r-sum-value.red { color: var(--danger); }

.r-hint {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-field);
  background: var(--bg);
  color: var(--muted);
  font-size: var(--text-micro);
}

/* One list, one rule between lines — the same block `PostavkeMeniSheet` uses,
   so the two sheets in this dashboard are visibly the same object. */
.r-facts { display: flex; flex-direction: column; }

.r-fact {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: var(--tap);
  padding: 8px 0;
  border-bottom: 1px solid var(--line-soft);
}

.r-fact:last-child { border-bottom: 0; }

.r-fact-label { font-size: var(--text-label); color: var(--muted); flex-shrink: 0; }

.r-fact-value {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  font-size: var(--text-body);
  font-weight: 500;
  color: var(--ink);
  text-align: right;
}
</style>
