<script setup lang="ts">
/**
 * *Zahtijeva pažnju* — the one list on the dashboard that is a to-do list.
 *
 * Rows come **oldest first** and that is a product rule, not a tie-break: a
 * storno that has been waiting since half past ten belongs above one from a
 * minute ago, so an owner who works down the list from the top is working down
 * it in the order the people at the bar have been waiting. The server already
 * sorts them; nothing here re-sorts.
 *
 * The card carries the flags underneath, visually quieter and without buttons
 * (see `PulsFlags`). One card, two lists, one heading — the owner has one place
 * to look.
 *
 * This component posts nothing. It hands the parent the action and the resolved
 * route; the parent owns the read that has to be refetched afterwards and the
 * badge in the nav that has to come down with it.
 */
import type { AttentionAction, AttentionItem, Flag } from '#shared/types'

defineProps<{
  items: AttentionItem[]
  flags: Flag[]
  /** The settlement accept route carries a shift id as well as its own. */
  shiftId?: string
  /** `"<ref_id>:<action>"` of the decision in flight, so only that button spins. */
  busy?: string | null
  /** `apiErrorText(err)` from the last decision that failed. */
  error?: string
}>()

const emit = defineEmits<{
  act: [item: AttentionItem, action: AttentionAction, target: string]
}>()

function pendingFor(item: AttentionItem, busy?: string | null): AttentionAction | null {
  if (!busy) return null
  const [refId, action] = busy.split('|')
  return refId === item.ref_id ? (action as AttentionAction) : null
}
</script>

<template>
  <UiCard title="Zahtijeva pažnju">
    <template #title>
      Zahtijeva pažnju
      <span v-if="items.length" class="a-att-n">{{ items.length }}</span>
    </template>

    <p v-if="error" class="a-att-error" role="alert">{{ error }}</p>

    <div v-if="items.length" class="a-att-list">
      <UiAttentionRow
        v-for="item in items"
        :key="`${item.ref_type}:${item.ref_id}`"
        :item="item"
        :shift-id="shiftId"
        :pending-action="pendingFor(item, busy)"
        @act="(action, target) => emit('act', item, action, target)"
      />
    </div>

    <!-- An empty to-do list is good news and should look like it, not like a
         card that failed to load. -->
    <div v-else class="a-att-done">
      <span class="a-att-done-mark" aria-hidden="true"><UiIcon name="check" :size="18" /></span>
      <span>Ništa ne čeka odluku</span>
    </div>

    <PulsFlags :flags="flags" />
  </UiCard>
</template>

<style scoped>
.a-att-list { display: flex; flex-direction: column; }

/* The count is the size of the queue, so it is a copper marker rather than the
   grey number every other card head carries — it is the reason to look here. */
.a-att-n {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 7px;
  border-radius: var(--radius-chip);
  background: var(--accent-soft);
  color: var(--accent-text);
  font-size: var(--text-caption);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  align-self: center;
}

.a-att-done {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0 10px;
  color: var(--ink-2);
  font-size: var(--text-body);
}

.a-att-done-mark {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-chip);
  background: var(--good-soft);
  color: var(--good);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.a-att-error {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-field);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: var(--text-label);
  font-weight: 500;
}
</style>
