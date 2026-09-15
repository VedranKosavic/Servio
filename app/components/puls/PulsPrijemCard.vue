<script setup lang="ts">
/**
 * *Prijem robe danas* — drawn on *Puls* only when goods were booked today.
 *
 * The card says one amount and when the last delivery was entered; a tap opens
 * a sheet with every delivery of the day — time, supplier, who entered it, the
 * articles and their amounts. Read-only: deliveries are booked and reversed on
 * *Roba → Prijem robe*, never from here. A reversed delivery is listed with a
 * mark and adds nothing to the total (`app/utils/pulsPrijem.ts`).
 */
import type { PrijemToday } from '~/utils/pulsPrijem'

const props = defineProps<{ prijem: PrijemToday }>()

const open = ref(false)

const count = computed(() => props.prijem.deliveries.length)
</script>

<template>
  <button type="button" class="p-card" @click="open = true">
    <span class="p-eyebrow">Prijem robe danas</span>
    <span class="p-amount">
      <UiMoney :fen="prijem.total_fen" :colour="false" />
    </span>
    <span class="p-line">
      <template v-if="prijem.last_at">
        {{ dateBs(prijem.last_at) }} · {{ timeBs(prijem.last_at) }}
      </template>
      · {{ count === 1 ? '1 prijem' : `${count} prijema` }}
    </span>
    <span class="p-more">
      Detalji
      <UiIcon name="chevron-right" :size="18" />
    </span>
  </button>

  <UiSheet :open="open" title="Prijem robe danas" @close="open = false">
    <div v-for="d in prijem.deliveries" :key="d.id" class="p-delivery">
      <div class="p-head">
        <strong>{{ d.supplier_name }}</strong>
        <UiPill v-if="d.reversed_at" tone="neutral">poništen</UiPill>
      </div>
      <p class="p-meta">
        {{ dateBs(d.created_at) }} · {{ timeBs(d.created_at) }} · {{ d.entered_by_name }}
        <template v-if="d.invoice_no"> · faktura {{ d.invoice_no }}</template>
      </p>

      <div v-for="line in d.lines" :key="line.stock_item_id" class="p-row">
        <span>{{ line.item_name }} <span class="p-muted num">× {{ line.qty }}</span></span>
        <UiMoney :fen="line.line_cost_fen" :colour="false" />
      </div>

      <div class="p-row p-total">
        <span>Ukupno</span>
        <UiMoney :fen="d.total_fen" :colour="false" />
      </div>
    </div>

    <template #footer>
      <UiButton variant="ghost" @click="open = false">Zatvori</UiButton>
    </template>
  </UiSheet>
</template>

<style scoped>
/* The same card shape as the shift cards above it, and the whole card is the target. */
.p-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
  padding: 18px 20px;
  border-radius: var(--radius-card);
  border: 1px solid var(--line);
  background: var(--surface);
  box-shadow: var(--shadow-card);
  font: inherit;
  text-align: left;
  color: var(--ink);
  cursor: pointer;
}

.p-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.p-eyebrow {
  font-size: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
}

.p-amount {
  font-family: var(--font-display);
  font-size: var(--text-metric);
  font-weight: 700;
}

.p-line { font-size: var(--text-label); color: var(--muted); }

.p-more {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-top: 4px;
  font-size: var(--text-label);
  font-weight: 600;
  color: var(--accent);
}

.p-delivery {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line-soft);
}

.p-delivery:last-child { border-bottom: 0; }

.p-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.p-meta { margin: 0; font-size: var(--text-micro); color: var(--muted); }

.p-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: var(--text-body);
}

.p-muted { color: var(--muted); }
.p-total { font-weight: 700; padding-top: 4px; }
</style>
