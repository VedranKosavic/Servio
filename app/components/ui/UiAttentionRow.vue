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
 *
 * **It has to read as work to do, not as a feed.** Three things do that: a
 * marker on the left saying at a glance what *kind* of decision this is, the
 * title at full row weight, and the buttons on a right-hand rail so the whole
 * column of them lines up and the owner can go down it without moving his eye
 * sideways. The marker is a shape and a colour together with a word in the
 * title — never a colour alone, because the same screen gets read from a
 * printed screenshot.
 */
import { attentionTarget } from '#shared/attention'
import type { AttentionAction, AttentionItem, AttentionKind } from '#shared/types'

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

/**
 * What the marker says. Money leaving the till and a storno are the two the
 * owner loses real money to, so they take the danger tone; a count and a
 * settlement are things waiting on him rather than against him.
 */
const TONES: Record<AttentionKind, 'bad' | 'warn' | 'accent'> = {
  void: 'bad',
  comp: 'warn',
  unpaid_tab: 'bad',
  payout: 'warn',
  float_out: 'warn',
  settlement: 'accent',
  count: 'accent',
  waste: 'warn',
}

const ICONS: Record<AttentionKind, 'x' | 'money' | 'box' | 'check' | 'clock' | 'users'> = {
  void: 'x',
  comp: 'users',
  unpaid_tab: 'clock',
  payout: 'money',
  float_out: 'money',
  settlement: 'check',
  count: 'box',
  waste: 'box',
}

/** Only the actions that actually have a route behind them get a button. */
const buttons = computed(() => props.item.actions
  .map(action => ({ action, target: attentionTarget(props.item, action, props.shiftId) }))
  .filter((b): b is { action: AttentionAction, target: string } => b.target !== null))
</script>

<template>
  <div class="a-att">
    <span class="a-att-mark" :class="`m-${TONES[item.kind]}`" aria-hidden="true">
      <UiIcon :name="ICONS[item.kind]" :size="16" />
    </span>

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
  border-bottom: 1px solid var(--line-soft);
  min-height: 58px;
}

.a-att:last-child { border-bottom: 0; }

.a-att-mark {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-chip);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.m-bad { background: var(--danger-soft); color: var(--danger); }
.m-warn { background: var(--warn-soft); color: var(--warn); }
.m-accent { background: var(--accent-soft); color: var(--accent-text); }

.a-att-text {
  flex-grow: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.a-att-title {
  font-size: var(--text-body);
  font-weight: 500;
  color: var(--ink);
}

.a-att-text small {
  font-size: var(--text-micro);
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

/* A rail, not a huddle: the buttons on every row start at the same x, so the
   owner works down the list without his eye leaving the column. */
.a-att-acts {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  justify-content: flex-end;
  min-width: 152px;
}

@media (max-width: 1023px) {
  /* Stacked, so the buttons keep 44 px and the title keeps its line. */
  .a-att {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr);
    gap: 8px 12px;
    align-items: center;
    padding: 12px 0;
  }

  .a-att-acts { grid-column: 2; min-width: 0; gap: 8px; justify-content: stretch; }
  .a-att-acts :deep(.a-btn) { flex: 1; }
}
</style>
