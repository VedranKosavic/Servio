<script setup lang="ts">
/**
 * One row of *Zahtijeva pažnju*.
 *
 * **It knows no routes.** The row carries a `ref_type` and a list of actions;
 * `attentionTarget()` (in `shared/attention.ts`, the same function the server
 * calls) turns the pair into `"POST /api/adjustments/…/decide"`. A path written
 * in a component is a path that drifts the day a route is renamed, and
 * `owner-live.test.ts` checks every pair in that table against `ROUTE_ROLES`.
 *
 * The parent does the posting: it owns the read that has to be refetched
 * afterwards, and it is the one that decrements the nav badge.
 */
import { attentionTarget } from '#shared/attention'
import type { AttentionAction, AttentionItem } from '#shared/types'

const props = defineProps<{
  item: AttentionItem
  /** The settlement accept route carries a shift id as well as its own. */
  shiftId?: string
  /** Which action is in flight, so only that button spins. */
  pendingAction?: AttentionAction | null
}>()

const emit = defineEmits<{ act: [action: AttentionAction, target: string] }>()

const LABELS: Record<AttentionAction, string> = {
  approve: 'Odobri',
  reject: 'Odbij',
  note: 'Bilješka',
}

const VARIANTS: Record<AttentionAction, 'primary' | 'ghost' | 'soft' | 'danger'> = {
  approve: 'primary',
  reject: 'danger',
  note: 'soft',
}

/** Only the actions that actually have a route behind them get a button. */
const buttons = computed(() => props.item.actions
  .map(action => ({ action, target: attentionTarget(props.item, action, props.shiftId) }))
  .filter((b): b is { action: AttentionAction, target: string } => b.target !== null))
</script>

<template>
  <div class="a-att">
    <div class="a-att-text">
      <span class="a-att-title">{{ item.title_bs }}</span>
      <small>
        {{ timeBs(item.at) }}
        <template v-if="item.amount_fen !== undefined">
          · <UiMoney :fen="item.amount_fen" :colour="false" />
        </template>
      </small>
    </div>

    <div class="a-att-acts">
      <UiButton
        v-for="button in buttons"
        :key="button.action"
        small
        :variant="VARIANTS[button.action]"
        :pending="pendingAction === button.action"
        @click="emit('act', button.action, button.target)"
      >{{ LABELS[button.action] }}</UiButton>
    </div>
  </div>
</template>

<style scoped>
.a-att {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--surface-2);
  min-height: 52px;
}

.a-att:last-child { border-bottom: 0; }

.a-att-text {
  flex-grow: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.a-att-title { font-weight: 500; }

.a-att-text small {
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.a-att-acts { display: flex; gap: 6px; flex-shrink: 0; }

@media (max-width: 1023px) {
  /* Stacked, so the buttons keep 44 px and the title keeps its line. */
  .a-att { flex-direction: column; align-items: stretch; gap: 8px; padding: 12px 0; }
  .a-att-acts { gap: 8px; }
  .a-att-acts :deep(.a-btn) { flex: 1; }
}
</style>
