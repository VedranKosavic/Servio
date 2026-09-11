<script setup lang="ts">
/**
 * The door that had to stay open.
 *
 * *Zahtijeva pažnju* is gone from *Puls* — the owner asked for four things on
 * this screen and a standing to-do list was not one of them. But two of the
 * buttons that list carried had no second home anywhere in the app: deciding a
 * *nije plaćeno* tab (`POST /api/tabs/:id/unpaid/decide` — *otpis* or
 * *naplatiti*, which is real money either way, and which keeps counting against
 * a waiter's expected cash until somebody answers it) and closing a shift over
 * a waiter who went home without handing his envelope in
 * (`POST /api/shifts/:id/force-close`). Deleting the list outright would have
 * left both with nowhere to be answered.
 *
 * So this is the smallest thing that is not stranding them: **one row, and only
 * when something is actually waiting**. On the ordinary night there is nothing
 * pending and the screen is the four things the owner asked for; when a
 * decision is waiting, one quiet line at the foot of the page says so and the
 * decisions themselves are behind it in a sheet.
 *
 * Everything else that list used to carry has another door and does not need
 * this one: an envelope and a payout are on *Smjena* (`SmjenaCashBox`), a count
 * on *Roba · Popisi*, an otpis on *Roba · Otpis*, and a storno or gratis on the
 * bartender's *Na čekanju*.
 *
 * This component posts nothing. It hands the page the action and the resolved
 * route; the page owns the read that has to be refetched afterwards.
 */
import type { AttentionAction, AttentionItem } from '#shared/types'

defineProps<{
  items: AttentionItem[]
  /** The settlement accept route carries a shift id as well as its own. */
  shiftId?: string
  /** `"<ref_id>|<action>"` of the decision in flight, so only that button spins. */
  busy?: string | null
  /** `apiErrorText(err)` from the last decision that failed. */
  error?: string
}>()

const emit = defineEmits<{
  act: [item: AttentionItem, action: AttentionAction, target: string]
}>()

const open = ref(false)

function pendingFor(item: AttentionItem, busy?: string | null): AttentionAction | null {
  if (!busy) return null
  const [refId, action] = busy.split('|')
  return refId === item.ref_id ? (action as AttentionAction) : null
}

/**
 * *Bilješka* — the force close — opens the page's own sheet to ask for a
 * sentence, so this one gets out of the way first: two scrims on a phone is one
 * scrim too many.
 */
function onAct(item: AttentionItem, action: AttentionAction, target: string) {
  if (decisionNeedsNote(item.ref_type, action)) open.value = false
  emit('act', item, action, target)
}
</script>

<template>
  <div class="a-foot">
    <button type="button" class="a-strip" @click="open = true">
      <span class="a-strip-mark" aria-hidden="true"><UiIcon name="clock" :size="16" /></span>
      <span class="a-strip-text">Čeka odluku</span>
      <span class="a-strip-n num">{{ items.length }}</span>
      <span class="a-strip-go">
        Pregledaj
        <UiIcon name="chevron-right" :size="18" />
      </span>
    </button>

    <UiSheet :open="open" title="Čeka odluku" @close="open = false">
      <p v-if="error" class="a-error" role="alert">{{ error }}</p>

      <div class="a-list">
        <UiAttentionRow
          v-for="item in items"
          :key="`${item.ref_type}:${item.ref_id}`"
          :item="item"
          :shift-id="shiftId"
          :pending-action="pendingFor(item, busy)"
          @act="(action, target) => onAct(item, action, target)"
        />
      </div>

      <template #footer>
        <UiButton variant="ghost" @click="open = false">Zatvori</UiButton>
      </template>
    </UiSheet>
  </div>
</template>

<style scoped>
/**
 * The layout's *Razgovor* button floats over the bottom-right corner of every
 * dashboard screen, and this row is the last thing on the page — so the page
 * ends with enough room under it for the row to scroll clear of the button
 * instead of finishing underneath it. The space costs nothing on the ordinary
 * night, because on the ordinary night this component is not rendered at all.
 */
@media (max-width: 1023px) {
  .a-foot { padding-bottom: 72px; }
}

/* A row, not a card: it is a way through to somewhere, and it must not look
   like one of the four things this screen is about. */
.a-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: var(--tap);
  padding: 8px 14px;
  border-radius: var(--radius-card);
  border: 1px solid var(--line);
  background: var(--surface);
  box-shadow: var(--shadow-card);
  font: inherit;
  font-size: var(--text-body);
  color: var(--ink);
  text-align: left;
  cursor: pointer;
  transition: box-shadow var(--dur-fast) var(--ease-standard);
}

.a-strip:hover { box-shadow: var(--shadow-raise); }
.a-strip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.a-strip-mark {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-chip);
  background: var(--warn-soft);
  color: var(--warn);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.a-strip-text { flex-grow: 1; min-width: 0; font-weight: 500; }

.a-strip-n {
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
  letter-spacing: 0;
  font-weight: 700;
}

.a-strip-go {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  color: var(--muted);
  font-size: var(--text-label);
  font-weight: 600;
}

/* The rows carry their own rule and their own padding, so they stack without
   the sheet's 14 px between them. */
.a-list { display: flex; flex-direction: column; }

.a-error {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-field);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: var(--text-label);
  font-weight: 500;
}
</style>
