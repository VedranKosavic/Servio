<script setup lang="ts">
/**
 * Under *Kasa* on *Smjena*: each invoice paid out of this shift afterwards,
 * with what was bought and what it cost (the owner, 17.09.2026). The numbers
 * are the invoice's as booked on *Prijem robe*.
 */
import { formatKm, formatQty } from '#shared/money'
import type { ShiftClosing, ShiftCostInvoice } from '#shared/types'

const props = defineProps<{ closing: ShiftClosing | null }>()

const paid = computed(() => (props.closing?.naknadni ?? [])
  .filter((cost): cost is typeof cost & { invoice: ShiftCostInvoice } => cost.invoice !== null))

function categories(invoice: ShiftCostInvoice): string {
  return [...new Set(invoice.lines.map(line => line.category_name || 'Bez kategorije'))].join(' · ')
}
</script>

<template>
  <UiCard v-if="paid.length" title="Plaćene fakture" :count="formatKm(paid.reduce((sum, cost) => sum + cost.amount_fen, 0))">
    <div class="f-list">
      <section v-for="cost in paid" :key="cost.id" class="f-doc">
        <header class="f-head">
          <span class="f-date num">{{ dateBs(cost.invoice.delivered_at) }}</span>
          <span class="f-cats">{{ categories(cost.invoice) }}</span>
          <UiPill v-if="cost.invoice.reversed_at" tone="bad">stornirano</UiPill>
          <strong class="f-total num">{{ formatKm(cost.amount_fen) }}</strong>
        </header>
        <p class="f-meta">
          <template v-if="cost.invoice.supplier_name">{{ cost.invoice.supplier_name }} · </template>
          <template v-if="cost.invoice.invoice_no">br. {{ cost.invoice.invoice_no }} · </template>
          unio {{ cost.invoice.entered_by_name }} · platio {{ cost.created_by_name }}
        </p>
        <ul class="f-lines">
          <li v-for="(line, i) in cost.invoice.lines" :key="i" class="f-line">
            <span class="f-name">{{ line.item_name }}</span>
            <span class="f-qty num">{{ formatQty(line.qty, line.base_unit) }}</span>
            <span class="f-cost num">{{ formatKm(line.line_cost_fen) }}</span>
          </li>
        </ul>
      </section>
    </div>
  </UiCard>
</template>

<style scoped>
.f-list { display: flex; flex-direction: column; gap: 12px; }
.f-doc { border: 1px solid var(--line); border-radius: var(--radius-card); overflow: hidden; }
.f-head {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 14px; background: var(--surface-2); border-bottom: 1px solid var(--line-soft);
}
.f-date { font-weight: 700; color: var(--ink); }
.f-cats { font-size: var(--text-label); font-weight: 600; color: var(--accent-ink); }
.f-total { margin-left: auto; color: var(--ink); }
.f-meta { margin: 0; padding: 8px 14px 0; font-size: var(--text-micro); color: var(--muted); }
.f-lines { list-style: none; margin: 0; padding: 6px 14px 10px; }
.f-line {
  display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 12px;
  padding: 4px 0; font-size: var(--text-label); border-bottom: 1px solid var(--line-soft);
}
.f-line:last-child { border-bottom: 0; }
.f-name { min-width: 0; overflow-wrap: anywhere; color: var(--ink); }
.f-qty { color: var(--muted); white-space: nowrap; }
.f-cost { white-space: nowrap; min-width: 72px; text-align: right; }
</style>
