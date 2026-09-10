<script setup lang="ts">
/**
 * *Po konobaru* — one row per person on the shift, and every number on it a
 * link to the rows behind it.
 *
 * **Two layouts, one set of numbers.** A nine-column table is the right shape on
 * a laptop and the wrong one on a 390 px phone, where it would either scroll
 * sideways forever or shrink below reading size. So the same `UserSummary[]`
 * renders as a `UiTable` at 1024 px and up, and as one card per person below it.
 * Nothing is dropped on the phone; the columns become labelled lines.
 *
 * **The verdict is a word.** `označeno za razgovor` is what an out-of-tolerance
 * envelope says, and it is a flag for a conversation, never an accusation —
 * `PLAN.md` §8 and §12. There is no ranking and no ordering by performance: the
 * rows come back in the summary's own order and stay in it.
 */
import { katChips, pluralBs, waiterVerdict } from './smjenaLogic'
import type { Settlement, Settings, UserSummary } from '#shared/types'

const props = defineProps<{
  shiftId: string
  users: UserSummary[]
  settlements: Settlement[]
  settings: Settings
  /** `category_id` → name. Only the venue fold carries names; this one does not. */
  categoryNames: Record<string, string>
}>()

const columns = [
  { key: 'konobar', label: 'Konobar' },
  { key: 'promet', label: 'Promet', align: 'r' as const },
  { key: 'stolovi', label: 'Stolovi', align: 'r' as const },
  { key: 'storna', label: 'Storna', align: 'r' as const },
  { key: 'sati', label: 'Sati', align: 'r' as const },
  { key: 'predao', label: 'Predao', align: 'r' as const },
  { key: 'ocekivano', label: 'Očekivano', align: 'r' as const },
  { key: 'ocjena', label: 'Ocjena' },
  { key: 'napomena', label: 'Napomena' },
]

/** The envelope this person handed in, if he has. */
function settlementOf(userId: string): Settlement | undefined {
  return props.settlements.find(s => s.user_id === userId)
}

const rows = computed(() => props.users.map((user) => {
  const settlement = settlementOf(user.user_id)
  const declared = settlement?.declared_fen ?? user.declared_fen ?? null

  // The quiet column. It is assembled from rows this page already has rather
  // than from a free-text field, because there is no per-waiter note anywhere in
  // the ledger and inventing one would be inventing a fact about a person.
  const notes: string[] = []
  if (user.card_fen > 0) notes.push(`kartica ${formatAmount(user.card_fen)}`)
  if (user.float_out_fen > 0) notes.push(`polog ${formatAmount(user.float_out_fen)}`)
  if (user.unpaid_fen > 0) notes.push(`nije plaćeno ${formatAmount(user.unpaid_fen)}`)
  if (user.post_settle_locks.count > 0) {
    const word = pluralBs(user.post_settle_locks.count, 'tura', 'ture', 'tura')
    notes.push(`${user.post_settle_locks.count} ${word} nakon predaje`)
  }
  if (settlement?.self_sealed) notes.push('sam zapečatio')
  if (settlement?.late) notes.push('predao kasno')

  return {
    user,
    declared,
    verdict: waiterVerdict(user, props.settings),
    chips: katChips(user.by_category, props.categoryNames),
    note: notes.join(' · '),
  }
}))

/** Where a number on this row drills to. `kat` is a category id or a preset. */
function to(userId: string, kat: string) {
  return { path: `/admin/smjena/${props.shiftId}/stavke`, query: { user: userId, kat } }
}
</script>

<template>
  <UiCard title="Po konobaru" :count="users.length">
    <!-- ≥ 1024 px: the dense table from the mockup. -->
    <div class="s-wide">
      <p v-if="!rows.length" class="s-quiet">Niko još nije zaključio turu.</p>
      <UiTable v-else :columns="columns">
        <template v-for="row in rows" :key="row.user.user_id">
          <tr>
            <td class="s-name">
              <NuxtLink :to="to(row.user.user_id, 'sve')">{{ row.user.name }}</NuxtLink>
            </td>
            <td class="r">
              <NuxtLink :to="to(row.user.user_id, 'sve')">
                <UiMoney :fen="row.user.promet_fen" :currency="false" :colour="false" />
              </NuxtLink>
            </td>
            <td class="r">{{ row.user.tabs }}</td>
            <td class="r">
              <NuxtLink :to="to(row.user.user_id, 'storno')">
                {{ row.user.storno.count }}
                <span class="s-quiet">({{ formatAmount(row.user.storno.fen) }})</span>
              </NuxtLink>
            </td>
            <td class="r">{{ durationBs(row.user.hours * 3600) }}</td>
            <td class="r">
              <UiMoney v-if="row.declared !== null" :fen="row.declared" :currency="false" :colour="false" />
              <span v-else class="s-quiet">—</span>
            </td>
            <td class="r">
              <UiMoney
                v-if="row.user.expected_fen !== undefined"
                :fen="row.user.expected_fen" :currency="false" :colour="false"
              />
              <span v-else class="s-quiet">—</span>
            </td>
            <td><UiPill :tone="row.verdict.tone">{{ row.verdict.word }}</UiPill></td>
            <td class="s-note">{{ row.note || '—' }}</td>
          </tr>
          <tr v-if="row.chips.length" class="s-chips-row">
            <td :colspan="columns.length">
              <div class="s-chips">
                <NuxtLink
                  v-for="chip in row.chips"
                  :key="chip.kat"
                  class="s-chip"
                  :to="to(row.user.user_id, chip.kat)"
                >{{ chip.label }} {{ chip.qty }}</NuxtLink>
                <NuxtLink
                  v-if="row.user.gratis.count"
                  class="s-chip"
                  :to="to(row.user.user_id, 'gratis')"
                >Gratis {{ row.user.gratis.count }}</NuxtLink>
              </div>
            </td>
          </tr>
        </template>
      </UiTable>
    </div>

    <!-- < 1024 px: the same person as a card, so nothing scrolls sideways. -->
    <div class="s-narrow">
      <p v-if="!rows.length" class="s-quiet">Niko još nije zaključio turu.</p>
      <article v-for="row in rows" :key="row.user.user_id" class="s-card">
        <header>
          <NuxtLink :to="to(row.user.user_id, 'sve')">{{ row.user.name }}</NuxtLink>
          <UiPill :tone="row.verdict.tone">{{ row.verdict.word }}</UiPill>
        </header>

        <dl>
          <div><dt>Promet</dt><dd><UiMoney :fen="row.user.promet_fen" :colour="false" /></dd></div>
          <div><dt>Stolovi</dt><dd>{{ row.user.tabs }}</dd></div>
          <div>
            <dt>Storna</dt>
            <dd>{{ row.user.storno.count }} · {{ formatAmount(row.user.storno.fen) }}</dd>
          </div>
          <div><dt>Sati</dt><dd>{{ durationBs(row.user.hours * 3600) }}</dd></div>
          <div>
            <dt>Predao</dt>
            <dd><UiMoney v-if="row.declared !== null" :fen="row.declared" :colour="false" /><span v-else>—</span></dd>
          </div>
          <div>
            <dt>Očekivano</dt>
            <dd>
              <UiMoney
                v-if="row.user.expected_fen !== undefined"
                :fen="row.user.expected_fen" :colour="false"
              /><span v-else>—</span>
            </dd>
          </div>
        </dl>

        <p v-if="row.note" class="s-note">{{ row.note }}</p>

        <div v-if="row.chips.length" class="s-chips">
          <NuxtLink
            v-for="chip in row.chips"
            :key="chip.kat"
            class="s-chip"
            :to="to(row.user.user_id, chip.kat)"
          >{{ chip.label }} {{ chip.qty }}</NuxtLink>
        </div>
      </article>
    </div>
  </UiCard>
</template>

<style scoped>
.s-narrow { display: none; }

.s-name { font-weight: 600; }
.s-quiet { color: var(--muted); }
.s-note { color: var(--muted); font-size: 13px; margin: 0; }

:deep(a) { color: inherit; text-decoration: none; }
:deep(a:hover) { text-decoration: underline; }

.s-chips-row :deep(td) { padding-top: 0; }

.s-chips { display: flex; flex-wrap: wrap; gap: 6px; }

.s-chip {
  height: 28px;
  padding: 0 10px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: var(--surface);
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}

@media (max-width: 1023px) {
  .s-wide { display: none; }
  .s-narrow { display: flex; flex-direction: column; gap: 12px; }

  .s-card {
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .s-card header {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
    font-size: 16px;
  }

  .s-card header :deep(.a-pill) { margin-left: auto; }

  .s-card dl {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 12px;
  }

  .s-card dl div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }

  .s-card dt {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    font-weight: 600;
  }

  .s-card dd { margin: 0; font-variant-numeric: tabular-nums; }

  .s-chip { height: 44px; border-radius: 22px; padding: 0 14px; font-size: 15px; }
}
</style>
