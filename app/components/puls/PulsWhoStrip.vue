<script setup lang="ts">
/**
 * *Ko radi* — who is on the shift that is running.
 *
 * It used to be one line of names inside a tile, because it was the fifth of
 * six figures across the top of the page. The owner asked for three things on
 * *Puls* and this is one of them, so it is a card of its own and the people are
 * rows: the initials in the shared `.avatar` circle, the name at row weight, and
 * the one thing about a person tonight the owner has to notice — whether he has
 * already handed his envelope in.
 *
 * **No money per person here.** The card says who is on, not who took what:
 * per-person figures live on *Smjena*, one screen further in, and CLAUDE.md is
 * explicit that the dashboard is accountability rather than a scoreboard.
 *
 * The card is only ever drawn while a shift is open — `live.who` is folded from
 * the focus shift, which is the last one of the day once tonight's has closed,
 * and a list of people who went home an hour ago is not *ko radi*.
 */
import type { LiveWho } from '#shared/types'

defineProps<{ who: LiveWho[] }>()
</script>

<template>
  <UiCard title="Ko radi" :count="who.length ? `${who.length}` : undefined">
    <ul v-if="who.length" class="a-who">
      <li v-for="person in who" :key="person.user_id" class="a-who-row">
        <span class="avatar avatar-sm" aria-hidden="true">{{ person.initials }}</span>
        <span class="a-who-name">{{ person.name }}</span>
        <UiPill v-if="person.settled" tone="good">predao</UiPill>
      </li>
    </ul>

    <p v-else class="a-who-none">Niko još nije prijavljen na smjenu.</p>
  </UiCard>
</template>

<style scoped>
.a-who { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }

.a-who-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 4px 0;
  border-bottom: 1px solid var(--line-soft);
  min-width: 0;
}

.a-who-row:last-child { border-bottom: 0; }

.a-who-name {
  flex-grow: 1;
  min-width: 0;
  font-size: var(--text-body);
  font-weight: 500;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.a-who-none { margin: 0; color: var(--muted); font-size: var(--text-label); }
</style>
