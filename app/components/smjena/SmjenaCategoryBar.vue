<script setup lang="ts">
/**
 * The night's category mix as one stacked bar, largest first.
 *
 * A bar and not a pie: the question the owner asks it is "did nargila carry the
 * night again?", which is a comparison of lengths, and lengths are read far more
 * accurately than angles. The percentage is a **width only** — every number on
 * screen is the amount in KM and the count, because a percentage of a night is
 * not a figure anybody can check against anything.
 *
 * Every segment and every legend row drills into the rows behind it.
 */
import { categoryMix } from './smjenaLogic'
import type { CategoryLine } from '#shared/types'

const props = defineProps<{
  shiftId: string
  categories: CategoryLine[]
}>()

const slices = computed(() => categoryMix(props.categories))

function to(kat: string) {
  return { path: `/a/smjena/${props.shiftId}/stavke`, query: { kat } }
}
</script>

<template>
  <UiCard title="Kategorije" :count="slices.length">
    <p v-if="!slices.length" class="s-quiet">Još nema naplaćenih stavki.</p>

    <template v-else>
      <div class="s-bar">
        <NuxtLink
          v-for="(slice, index) in slices"
          :key="slice.category_id"
          class="s-seg"
          :class="`n${index % 5}`"
          :style="{ width: `${slice.pct}%` }"
          :to="to(slice.category_id)"
          :aria-label="`${slice.name} ${formatKm(slice.fen)}`"
        />
      </div>

      <ul class="s-legend">
        <li v-for="(slice, index) in slices" :key="slice.category_id">
          <span class="s-dot" :class="`n${index % 5}`" />
          <NuxtLink :to="to(slice.category_id)">{{ slice.name }}</NuxtLink>
          <small>{{ slice.qty }}</small>
          <UiMoney :fen="slice.fen" :colour="false" />
        </li>
      </ul>
    </template>
  </UiCard>
</template>

<style scoped>
.s-bar {
  display: flex;
  height: 18px;
  border-radius: 9px;
  overflow: hidden;
  background: var(--surface-2);
  gap: 1px;
}

.s-seg { display: block; min-width: 2px; }

/* Five steps of the palette, reused round-robin. They are tints of the tokens
   and not new colours, so the bar cannot drift away from the rest of `/a`. */
.n0, .s-dot.n0 { background: var(--accent); }
.n1, .s-dot.n1 { background: var(--good); }
.n2, .s-dot.n2 { background: var(--warn); }
.n3, .s-dot.n3 { background: var(--accent-ink); }
.n4, .s-dot.n4 { background: var(--ink-2); }

.s-legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 6px 16px;
}

.s-legend li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  min-width: 0;
}

.s-legend a { color: inherit; text-decoration: none; flex-grow: 1; min-width: 0; }
.s-legend a:hover { text-decoration: underline; }
.s-legend small { color: var(--muted); font-variant-numeric: tabular-nums; }

.s-dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }

.s-quiet { margin: 0; color: var(--muted); }

@media (max-width: 1023px) {
  .s-legend { grid-template-columns: 1fr; }
  .s-legend li { min-height: 44px; }
}
</style>
