<script setup lang="ts">
/**
 * *Popisi* — the opening and closing counts of the night.
 *
 * A count that is still `submitted` has **not moved any stock**: it is a set of
 * numbers somebody wrote down, and the variance beside it is what would happen
 * if the owner signed it. *Primijeni* is that signature —
 * `POST /api/stock/counts/:id/confirm` — and it is the only thing on this card
 * that writes anything. That two-step is deliberate: a miscount corrected before
 * confirming costs nothing, and a confirmed one is an append-only correction to
 * the ledger.
 *
 * The lines behind a count live on `/admin/roba/popisi/:id`, which is WP3's; this
 * card links there rather than fetching a second read of its own.
 */
import { COUNT_KIND_WORDS, COUNT_PHASE_WORDS, countPill } from './smjenaLogic'
import type { ShiftCountBrief } from '#shared/types'

defineProps<{
  counts: ShiftCountBrief[]
  busyId?: string | null
}>()

const emit = defineEmits<{ confirm: [countId: string] }>()
</script>

<template>
  <UiCard title="Popisi" :count="counts.length">
    <p v-if="!counts.length" class="s-quiet">
      Za ovu smjenu nema popisa.
    </p>

    <article v-for="count in counts" :key="count.id" class="s-count">
      <div class="s-count-text">
        <strong>{{ COUNT_PHASE_WORDS[count.phase] }}</strong>
        <small>
          {{ COUNT_KIND_WORDS[count.kind] }} · {{ timeBs(count.submitted_at) }}
          · {{ count.counted_by_name }}
          <template v-if="count.confirmed_at">
            · potvrđen {{ timeBs(count.confirmed_at) }}
          </template>
        </small>
      </div>

      <span class="s-count-var">
        <span class="s-quiet">manjak</span>
        <UiMoney :fen="count.variance_fen" :currency="false" />
      </span>

      <UiPill :tone="countPill(count).tone">{{ countPill(count).word }}</UiPill>

      <NuxtLink class="s-count-link" :to="`/admin/roba/popisi/${count.id}`">Stavke</NuxtLink>

      <UiButton
        v-if="count.status === 'submitted'"
        small variant="primary"
        :pending="busyId === count.id"
        @click="emit('confirm', count.id)"
      >Primijeni</UiButton>
    </article>
  </UiCard>
</template>

<style scoped>
.s-count {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--surface-2);
  flex-wrap: wrap;
}

.s-count:last-child { border-bottom: 0; }

.s-count-text { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.s-count-text small { color: var(--muted); font-size: var(--text-caption); font-variant-numeric: tabular-nums; }

.s-count-var { display: flex; align-items: center; gap: 6px; font-size: var(--text-label); }

.s-count-link {
  color: var(--accent-ink);
  font-size: var(--text-micro);
  font-weight: 600;
  text-decoration: none;
}

.s-count-link:hover { text-decoration: underline; }

.s-quiet { color: var(--muted); font-size: var(--text-label); margin: 0; }

@media (max-width: 1023px) {
  .s-count-text { flex-basis: 100%; }
  .s-count :deep(.a-btn) { flex-grow: 1; }
  .s-count-link { min-height: 44px; display: inline-flex; align-items: center; }
}
</style>
