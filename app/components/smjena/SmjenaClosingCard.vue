<script setup lang="ts">
/**
 * *Zaključenje smjene* — the šanker's close, as the owner reads it.
 *
 * Every number is the stored `shift_closings` row, never recomputed here: the
 * point of storing it is that a void decided on Tuesday does not rewrite what
 * was handed over on Monday night. *Sav prihod*, *Dnevnica* and *Otpis* were
 * the server's at that moment; the five below them are what the šanker typed.
 * A negative *Za predati* is shown as it is, in the danger colour.
 */
import { formatKm } from '#shared/money'
import { CLOSING_LINES } from '#shared/closing'
import type { ShiftClosing } from '#shared/types'

defineProps<{ closing: ShiftClosing }>()
</script>

<template>
  <UiCard title="Zaključenje smjene">
    <p class="c-who">
      Zaključio {{ closing.closed_by_name }} · {{ dateTimeBs(closing.created_at) }}
    </p>

    <dl class="c-lines">
      <div class="c-row">
        <dt>Sav prihod</dt>
        <dd class="num">{{ formatKm(closing.prihod_fen) }}</dd>
      </div>
      <div v-for="line in CLOSING_LINES" :key="line.key" class="c-row">
        <dt>− {{ line.label }}</dt>
        <dd class="num">{{ formatKm(closing[line.key]) }}</dd>
      </div>
      <div class="c-row c-total">
        <dt>Za predati</dt>
        <dd class="num" :class="{ bad: closing.za_predati_fen < 0 }">
          {{ formatKm(closing.za_predati_fen) }}
        </dd>
      </div>
    </dl>

    <p v-if="closing.note" class="c-note">{{ closing.note }}</p>
  </UiCard>
</template>

<style scoped>
.c-who { margin: 0 0 10px; color: var(--muted); font-size: var(--text-label); }

.c-lines { margin: 0; display: flex; flex-direction: column; gap: 6px; max-width: 420px; }

.c-row { display: flex; justify-content: space-between; gap: 12px; }
.c-row dt { color: var(--ink-2); }
.c-row dd { margin: 0; }

.c-total {
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
  font-weight: 700;
}
.c-total dt { color: var(--ink); }
.c-total .bad { color: var(--danger); }

.c-note { margin: 10px 0 0; color: var(--muted); font-size: var(--text-label); }
</style>
