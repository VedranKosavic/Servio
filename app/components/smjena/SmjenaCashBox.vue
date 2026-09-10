<script setup lang="ts">
/**
 * *Kasa* — where the money was, where it went, and what is missing.
 *
 * The rows read top to bottom the way the drawer actually filled and emptied:
 * početni polog → dopune → izdato konobarima → isplate → povrati → uzeo iz kase
 * → očekivano → prebrojano → razlika. Every one of them is a `cash_movements`
 * row or a field of the written summary; nothing here is computed twice.
 *
 * **A pending row carries its decision.** `payout` and `float_out` are the two
 * types born `pending` (BACKEND §6.5), and the owner decides them here rather
 * than having to go back to *Puls* — same route, same body, same result.
 *
 * The settlements below are the envelopes. Each shows the pair PLAN §11 asks
 * for — what the difference was when it was sealed and what it is now — because
 * a void decided the next morning moves the second number and not the first,
 * and showing only one of them is how somebody gets asked about a shortfall
 * that has already been explained.
 */
import { cardRows, cashRows, cashVerdict, settlementDrift } from './smjenaLogic'
import type {
  CashMovement, Settlement, Settings, Shift, ShiftSummary, UserSummary,
} from '#shared/types'

const props = defineProps<{
  shift: Shift
  summary: ShiftSummary
  movements: CashMovement[]
  settlements: Settlement[]
  users: UserSummary[]
  settings: Settings
  /** The id of the row whose button is in flight, so only that one spins. */
  busyId?: string | null
}>()

const emit = defineEmits<{
  decide: [movementId: string, outcome: 'approved' | 'rejected']
  accept: [settlementId: string]
  pickup: []
  openingFloat: []
}>()

const rows = computed(() => cashRows(props.shift, props.summary, props.movements))
const card = computed(() => cardRows(props.shift, props.summary))

/** The venue expectation is what the tolerance is a percentage of at a close. */
const diffVerdict = computed(() =>
  cashVerdict(props.summary.diff_fen, props.summary.expected_cash_fen, props.settings))

const envelopes = computed(() => props.settlements.map(settlement => ({
  settlement,
  drift: settlementDrift(
    settlement, props.users.find(u => u.user_id === settlement.user_id),
  ),
})))
</script>

<template>
  <UiCard title="Kasa">
    <template #actions>
      <UiButton small variant="ghost" @click="emit('openingFloat')">Početni polog</UiButton>
      <UiButton small variant="ghost" @click="emit('pickup')">Uzeo iz kase</UiButton>
    </template>

    <dl class="s-rows">
      <div v-for="row in rows" :key="row.key" class="s-row" :class="{ total: row.total }">
        <dt>
          {{ row.label }}
          <small v-if="row.sub">{{ row.sub }}</small>
        </dt>
        <dd>
          <UiMoney v-if="row.fen !== null" :fen="row.fen" :currency="false" />
          <span v-else class="s-quiet">nije uneseno</span>
          <UiPill
            v-if="row.key === 'diff' && diffVerdict"
            :tone="diffVerdict.tone"
          >{{ diffVerdict.word }}</UiPill>
          <span v-if="row.movementId" class="s-acts">
            <UiButton
              small variant="primary"
              :pending="busyId === row.movementId"
              @click="emit('decide', row.movementId, 'approved')"
            >Odobri</UiButton>
            <UiButton
              small variant="danger"
              :pending="busyId === row.movementId"
              @click="emit('decide', row.movementId, 'rejected')"
            >Odbij</UiButton>
          </span>
        </dd>
      </div>
    </dl>

    <h3>Kartica</h3>
    <dl class="s-rows">
      <div v-for="row in card" :key="row.key" class="s-row" :class="{ total: row.total }">
        <dt>{{ row.label }}</dt>
        <dd>
          <UiMoney v-if="row.fen !== null" :fen="row.fen" :currency="false" />
          <span v-else class="s-quiet">nije uneseno</span>
        </dd>
      </div>
    </dl>

    <h3>Predaje</h3>
    <p v-if="!envelopes.length" class="s-quiet">Niko još nije predao kovertu.</p>
    <div v-for="row in envelopes" :key="row.settlement.id" class="s-env">
      <div class="s-env-text">
        <strong>{{ row.settlement.user_name }}</strong>
        <small>
          predao <UiMoney :fen="row.settlement.declared_fen" :colour="false" />
          · u trenutku predaje <UiMoney :fen="row.drift.then" :currency="false" />
          <template v-if="row.drift.now !== null && row.drift.now !== row.drift.then">
            · sada <UiMoney :fen="row.drift.now" :currency="false" />
          </template>
          <template v-if="row.settlement.accepted_at">
            · primio {{ row.settlement.accepted_by_name }} {{ timeBs(row.settlement.accepted_at) }}
          </template>
        </small>
      </div>
      <UiPill v-if="row.settlement.self_sealed && !row.settlement.accepted_at" tone="warn">
        sam zapečatio
      </UiPill>
      <UiButton
        v-if="!row.settlement.accepted_at"
        small variant="primary"
        :pending="busyId === row.settlement.id"
        @click="emit('accept', row.settlement.id)"
      >Prihvati</UiButton>
    </div>
  </UiCard>
</template>

<style scoped>
.s-rows { margin: 0; display: flex; flex-direction: column; gap: 8px; }

.s-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 12px;
  align-items: baseline;
  font-size: var(--text-label);
}

.s-row dt { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.s-row dt small { color: var(--muted); font-size: var(--text-caption); }

.s-row dd {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
  font-variant-numeric: tabular-nums;
}

/* A subtotal gets a rule above it and a heavier figure — the eye needs to know
   which of these lines the ones before it add up to. */
.s-row.total {
  border-top: 1px solid var(--line);
  padding-top: 8px;
  font-weight: 600;
}

.s-acts { display: flex; gap: 8px; }

h3 {
  margin: 4px 0 0;
  font-size: var(--text-micro);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  font-weight: 600;
}

.s-quiet { color: var(--muted); font-size: var(--text-label); margin: 0; }

.s-env {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--surface-2);
}

.s-env:last-child { border-bottom: 0; }
.s-env-text { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.s-env-text small { color: var(--muted); font-size: var(--text-caption); }

@media (max-width: 1023px) {
  .s-env { flex-wrap: wrap; }
  .s-env :deep(.a-btn) { flex-grow: 1; }
  .s-acts :deep(.a-btn) { flex: 1; }
}
</style>
