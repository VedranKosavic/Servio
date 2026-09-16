<script setup lang="ts">
/**
 * *Kasa* — the šanker's *Zaključi smjenu*, as the owner reads it.
 *
 * Every number is the stored `shift_closings` row, never recomputed here: the
 * point of storing it is that a void decided on Tuesday does not rewrite what
 * was handed over on Monday night. *Sav prihod*, *Dnevnica* and *Otpis* were
 * the server's at that moment; the typed ones and *Dodatna plaćanja* are the
 * šanker's own.
 * A negative *Za predati* is shown as it is, in the danger colour. A shift the
 * šanker has not closed yet has no row, and the card says so.
 */
import { formatKm } from '#shared/money'
import { closingLines } from '#shared/closing'
import type { ShiftClosing } from '#shared/types'

defineProps<{ closing: ShiftClosing | null }>()
</script>

<template>
  <UiCard title="Kasa">
    <template v-if="closing">
      <p class="c-who">
        Zaključio {{ closing.closed_by_name }} · {{ dateTimeBs(closing.created_at) }}
      </p>

      <dl class="c-lines">
        <div class="c-row">
          <dt>Sav prihod</dt>
          <dd class="num">{{ formatKm(closing.prihod_fen) }}</dd>
        </div>
        <div
          v-for="(line, index) in closingLines(closing, closing.extras)"
          :key="`${line.label}-${index}`"
          class="c-row"
        >
          <dt>− {{ line.label }}</dt>
          <dd class="num">{{ formatKm(line.fen) }}</dd>
        </div>
        <div class="c-row c-total">
          <dt>Za predati</dt>
          <dd class="num" :class="{ bad: closing.za_predati_fen < 0 }">
            {{ formatKm(closing.za_predati_fen) }}
          </dd>
        </div>
      </dl>

      <p v-if="closing.note" class="c-note">{{ closing.note }}</p>
    </template>

    <p v-else class="c-empty">
      Smjena još nije zaključena. Kasa se popuni kad šanker zaključi smjenu.
    </p>
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
.c-empty { margin: 0; color: var(--muted); font-size: var(--text-label); }
</style>
