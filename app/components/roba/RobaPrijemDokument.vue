<script setup lang="ts">
/**
 * One concluded delivery note, opened from the history.
 *
 * It is the whole document: who entered it, when it is dated, what it cost, and
 * every article on it. **Who entered it is the point of the screen** — a
 * delivery is the one thing on this dashboard that adds stock rather than
 * spending it, and the only defence against a crate booked that never arrived is
 * that the document carries a name nobody typed. The server takes the actor from
 * the session; no body ever names it.
 *
 * **A delivery is never deleted.** A mistake is *stornirano*: the reversal writes
 * the opposite movements and leaves both documents in the ledger, so the
 * evening's paper trail still adds up a year from now. The reason is required
 * and it is required for the same reason the name is there.
 *
 * The reversal asks its question **inside this sheet**, not in a second one
 * stacked on top of it. Two scrims on a phone is one scrim too many, and the
 * question is about the document already on screen.
 */
import type { DeliveryView } from '#shared/types'

const props = defineProps<{
  open: boolean
  /** Read fresh by the page every render, so a refetch moves it under the sheet. */
  delivery: DeliveryView | null
  pending: boolean
  error: string
}>()

const emit = defineEmits<{
  close: []
  reverse: [note: string]
}>()

/** The sheet has two states: reading the document, and asking why to reverse it. */
const asking = ref(false)
const note = ref('')

watch(() => [props.open, props.delivery?.id], () => {
  asking.value = false
  note.value = ''
})

const canReverse = computed(() => note.value.trim().length >= 3)
</script>

<template>
  <UiSheet
    :open="open"
    :title="delivery?.supplier_name ?? 'Prijem'"
    :content-key="asking ? 'storno' : 'pregled'"
    @close="emit('close')"
  >
    <template v-if="delivery">
      <div class="p-facts">
        <div class="p-fact">
          <span class="p-fact-label">Datum</span>
          <span class="p-fact-value num">{{ dateBs(delivery.delivered_at) }}</span>
        </div>
        <div class="p-fact">
          <span class="p-fact-label">Unio</span>
          <span class="p-fact-value">{{ delivery.entered_by_name }}</span>
        </div>
        <div class="p-fact">
          <span class="p-fact-label">Ukupno</span>
          <span class="p-fact-value num"><UiMoney :fen="delivery.total_fen" :colour="false" /></span>
        </div>
        <div v-if="delivery.invoice_no" class="p-fact">
          <span class="p-fact-label">Otpremnica</span>
          <span class="p-fact-value">{{ delivery.invoice_no }}</span>
        </div>
        <div class="p-fact">
          <span class="p-fact-label">Status</span>
          <span class="p-fact-value">
            <UiPill :tone="delivery.reversed_at ? 'bad' : 'good'">
              {{ delivery.reversed_at ? 'stornirano' : 'proknjiženo' }}
            </UiPill>
          </span>
        </div>
      </div>

      <ul class="p-lines">
        <li v-for="line in delivery.lines" :key="line.stock_item_id" class="p-line">
          <span class="p-line-name">{{ line.item_name }}</span>
          <span class="p-line-qty num">{{ line.qty }}</span>
          <span class="p-line-cost num"><UiMoney :fen="line.line_cost_fen" :colour="false" /></span>
        </li>
      </ul>

      <p v-if="delivery.note" class="p-note">{{ delivery.note }}</p>

      <p v-if="delivery.reversal_note" class="p-note">
        Storno: {{ delivery.reversal_note }}
      </p>

      <template v-if="asking">
        <p class="p-warn">
          Prijem se ne briše. Storno upisuje suprotne redove u ledger i oba
          dokumenta ostaju vidljiva. Napiši zašto.
        </p>
        <UiField
          v-model="note"
          label="Razlog"
          kind="textarea"
          placeholder="Npr. faktura je unesena dva puta"
          :error="error"
        />
      </template>

      <p v-else-if="error" class="p-error">{{ error }}</p>
    </template>

    <template #footer>
      <template v-if="asking">
        <UiButton variant="ghost" @click="asking = false">Odustani</UiButton>
        <UiButton
          variant="danger"
          :disabled="!canReverse"
          :pending="pending"
          @click="emit('reverse', note.trim())"
        >Storniraj</UiButton>
      </template>
      <template v-else>
        <UiButton variant="ghost" @click="emit('close')">Zatvori</UiButton>
        <UiButton
          v-if="delivery && !delivery.reversed_at"
          variant="danger"
          @click="asking = true"
        >Storniraj</UiButton>
      </template>
    </template>
  </UiSheet>
</template>

<style scoped>
/* One list, one rule between lines — the same block every sheet on this
   dashboard uses, so they read as one object in two places. */
.p-facts { display: flex; flex-direction: column; }

.p-fact {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: var(--tap);
  padding: 8px 0;
  border-bottom: 1px solid var(--line-soft);
}

.p-fact:last-child { border-bottom: 0; }
.p-fact-label { font-size: var(--text-label); color: var(--muted); flex-shrink: 0; }

.p-fact-value {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--ink);
  text-align: right;
}

.p-lines {
  margin: 0;
  padding: 4px 0 0;
  list-style: none;
  display: flex;
  flex-direction: column;
}

.p-line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: baseline;
  gap: 4px 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line-soft);
}

.p-line:last-child { border-bottom: 0; }
.p-line-name { font-size: var(--text-body); min-width: 0; }
.p-line-qty { font-size: var(--text-label); color: var(--muted); white-space: nowrap; }
.p-line-cost { font-size: var(--text-body); font-weight: 500; white-space: nowrap; }

.p-note { margin: 0; color: var(--muted); font-size: var(--text-micro); }
.p-error { margin: 0; color: var(--danger); font-size: var(--text-label); }

.p-warn {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-field);
  background: var(--warn-soft);
  color: var(--warn);
  font-size: var(--text-label);
  font-weight: 500;
}
</style>
