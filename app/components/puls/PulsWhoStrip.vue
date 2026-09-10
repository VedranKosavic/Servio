<script setup lang="ts">
/**
 * *Ko radi* — the inside of the fifth tile.
 *
 * One line of names, then the two things about tonight's staff the owner
 * actually has to notice: who has already handed his envelope in (*predao*),
 * and whose phone is holding rounds it has not managed to send.
 *
 * **No money per person here.** The tile says who is on, not who took what:
 * per-person figures live on *Smjena*, one click further in, and CLAUDE.md is
 * explicit that the dashboard is accountability rather than a scoreboard.
 */
import type { LiveWho, StaleDevice } from '#shared/types'

const props = defineProps<{
  who: LiveWho[]
  unsent: StaleDevice[]
}>()

const names = computed(() => props.who.map(person => person.name).join(' · '))
const settled = computed(() => props.who.filter(person => person.settled))
</script>

<template>
  <div class="a-who-strip">
    <p v-if="who.length" class="a-who-names">{{ names }}</p>
    <p v-else class="a-who-none">Niko još nije prijavljen</p>

    <div v-if="settled.length || unsent.length" class="a-who-pills">
      <UiPill v-for="person in settled" :key="person.user_id" tone="good">
        {{ person.name }} · predao
      </UiPill>
      <UiPill v-for="device in unsent" :key="device.device_id" tone="warn">
        {{ device.label }} · bez veze
      </UiPill>
    </div>
  </div>
</template>

<style scoped>
.a-who-strip {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.a-who-names {
  margin: 0;
  font-size: var(--text-body);
  font-weight: 600;
  line-height: 1.3;
  color: var(--ink);
}

.a-who-none { margin: 0; font-size: var(--text-body); color: var(--muted); }

.a-who-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
