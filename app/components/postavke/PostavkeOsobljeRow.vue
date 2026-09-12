<script setup lang="ts">
/**
 * One person on *Osoblje*, the way a phone draws it.
 *
 * The laptop gets a table, and a table is right at a desk. On a 390 px screen
 * the same four columns — *Ime*, *Inicijali*, *Uloga*, *PIN* — were a box the
 * owner dragged sideways, with the PIN pill clipped at the right edge. So below
 * 1024 px the row stops being a table row and becomes what it actually is:
 * **a person, and a way in.**
 *
 * **The name does the talking.** *Inicijali* is a derived two-letter string and
 * never deserved a column of its own; it is the circle on the left, the same
 * `.avatar` the lock screen and the rail already draw. Copper is that circle
 * only for the signed-in owner himself (DESIGN §2) — which is also the quietest
 * way this screen can say why *Ugasi radnika* refuses on one row.
 *
 * **State is a mark, not a column.** The role is one muted word and the only
 * pill is the answer to the question this screen exists for: can this person
 * sign in. A person who is off the staff carries no PIN mark at all, because a
 * deactivated account holds no PIN against anybody and his stored digits are
 * dropped the moment he comes back — a *postavljen* pill on a retired row is a
 * fact the pad would disagree with.
 *
 * Everything a person's account can have done to it — a PIN, a rename, a role,
 * the way out — is one tap behind the row, in `PostavkeOsobljeSheet`.
 */
import type { UserAdmin } from '#shared/types'
import { ROLE_LABELS } from '#shared/landing'

const props = defineProps<{
  user: UserAdmin
  /** The signed-in owner. His own circle is copper, and only his. */
  isMe: boolean
}>()

const emit = defineEmits<{ open: [] }>()

/** Stored, but a row still has to draw a circle for a person who has none. */
const initials = computed(() =>
  props.user.initials || props.user.name.slice(0, 2).toUpperCase())
</script>

<template>
  <button type="button" class="p-row" :class="{ off: !user.active }" @click="emit('open')">
    <span class="avatar" :class="{ 'avatar-accent': isMe }" aria-hidden="true">
      {{ initials }}
    </span>

    <span class="p-text">
      <span class="p-name">{{ user.name }}</span>
      <span class="p-marks">
        <span class="p-role">{{ ROLE_LABELS[user.role] }}</span>
        <template v-if="user.active">
          <!-- A worker's PIN is printed; an admin's cannot be, so his row says
               only that he has one. `pin_plain` is null for every admin. -->
          <span v-if="user.pin_plain" class="p-pin num">{{ user.pin_plain }}</span>
          <UiPill v-else-if="user.has_pin" tone="good">ima PIN</UiPill>
          <UiPill v-else tone="warn">bez PIN-a</UiPill>
        </template>
      </span>
    </span>

    <UiIcon class="p-chev" name="chevron-right" :size="20" />
  </button>
</template>

<style scoped>
.p-row {
  /* circle · who · the way in */
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: var(--tap);
  padding: 10px 6px 10px 16px;
  border: 0;
  border-bottom: 1px solid var(--line-soft);
  background: transparent;
  font: inherit;
  color: var(--ink);
  text-align: left;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}

.p-row:last-child { border-bottom: 0; }
.p-row:hover { background: var(--surface-3); }
.p-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.p-row:active { background: var(--surface-2); }

.p-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }

.p-name {
  font-size: var(--text-body);
  font-weight: 600;
  line-height: 1.3;
  /* A name is short; one that is not still belongs on one line here, because
     the row below it is the next person. */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Off the staff: one step quieter, never faded — a name at 60 % opacity on paper
   is a name the owner has to lean in to read, and he is reading it to decide
   whether to bring the person back. */
.p-row.off .p-name { color: var(--ink-2); }

.p-marks {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  min-width: 0;
}

.p-role { font-size: var(--text-micro); color: var(--muted); }

.p-chev { flex-shrink: 0; color: var(--muted); margin-right: 8px; }

/**
 * The PIN, where the *ima PIN* pill used to be.
 *
 * Tabular numerals and a little tracking, because these four digits are read
 * out loud across a bar — the one job this number has is to be unmistakable at
 * arm's length.
 */
.p-pin {
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
</style>
