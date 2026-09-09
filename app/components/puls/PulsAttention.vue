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
  <UiCard title="Zahtijeva pažnju" :count="items.length">
    <p v-if="error" class="a-att-error">{{ error }}</p>

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

    <p v-else class="a-att-empty">Ništa ne čeka odluku.</p>

    <PulsFlags :flags="flags" />
  </UiCard>
</template>

<style scoped>
.a-att-list { display: flex; flex-direction: column; }

.a-att-empty { margin: 0; color: var(--muted); font-size: 14px; }

.a-att-error {
  margin: 0;
  color: var(--danger);
  font-size: 14px;
}
</style>
