<script setup lang="ts">
/**
 * *Moja smjena* after the envelope — the money, and the verdict in words.
 *
 * It only ever renders from a `UserSummary` the server sent *after* a
 * settlement row existed. Nothing on this screen computes an expected amount,
 * and nothing infers one from the lines: the recorded pair `declared_fen` /
 * `expected_at_declare_fen` on the settlement row is the evidence, and this is
 * a reading of it (BACKEND §6.6).
 *
 * *U toleranciji* / *van tolerancije* is said in words as well as in colour —
 * a waiter reading a green number in a dark corner should not have to know what
 * green means, and the sentence never accuses anybody of anything.
 */
import { formatKm } from '#shared/money'
import type { MyShiftCounts, Settlement, UserSummary } from '#shared/types'

const props = defineProps<{
  summary: UserSummary
  settlement: Settlement | null
  /**
   * Where the category *names* come from.
   *
   * `summarizeUser` returns `by_category` as pure numbers on purpose — the same
   * array is written into `shift_summaries.by_user_json`, and a ledger row does
   * not store display strings that a rename would make wrong (BACKEND §3.2).
   * `counts.by_category` covers exactly the same categories and carries the
   * names, so the join happens here, at the last possible moment.
   */
  counts: MyShiftCounts
}>()

const categoryNames = computed(() =>
  new Map(props.counts.by_category.map(c => [c.category_id, c.name])))

const diff = computed(() => props.settlement?.diff_fen ?? 0)

const verdict = computed(() => {
  if (props.summary.within_tolerance === undefined) return null
  return props.summary.within_tolerance
    ? {
        tone: 'text-good',
        word: 'U toleranciji',
        detail: `Razlika je unutar dozvoljenih ${formatKm(props.summary.tolerance_fen ?? 0)}. Sve je u redu.`,
      }
    : {
        tone: 'text-warn',
        word: 'Van tolerancije',
        detail: 'Označeno za razgovor — nije optužba, nego stavka koju vlasnik pregleda.',
      }
})

function diffLabel(fen: number): string {
  if (fen === 0) return 'Tačno'
  return fen > 0 ? `Višak ${formatKm(fen)}` : `Manjak ${formatKm(Math.abs(fen))}`
}
</script>

<template>
  <section class="card flex flex-col gap-3 p-4">
    <div class="flex items-baseline justify-between gap-3">
      <h2 class="text-xl font-bold">
        Pazar je predan
      </h2>
      <span v-if="verdict" class="text-[15px] font-semibold" :class="verdict.tone">
        {{ verdict.word }}
      </span>
    </div>

    <div class="flex flex-col gap-1.5 text-[17px]">
      <div class="flex justify-between gap-3">
        <span class="text-text-2">Promet</span>
        <span class="num font-semibold">{{ formatKm(summary.promet_fen) }}</span>
      </div>
      <div class="flex justify-between gap-3">
        <span class="text-text-2">Gotovina</span>
        <span class="num">{{ formatKm(summary.cash_fen) }}</span>
      </div>
      <div v-if="summary.card_fen" class="flex justify-between gap-3">
        <span class="text-text-2">Kartica</span>
        <span class="num">{{ formatKm(summary.card_fen) }}</span>
      </div>
      <div v-if="settlement" class="flex justify-between gap-3 border-t border-line pt-1.5">
        <span class="text-text-2">Predao</span>
        <span class="num font-semibold">{{ formatKm(settlement.declared_fen) }}</span>
      </div>
      <div v-if="settlement" class="flex justify-between gap-3">
        <span class="text-text-2">Razlika</span>
        <span class="num font-bold" :class="verdict?.tone">{{ diffLabel(diff) }}</span>
      </div>
    </div>

    <p v-if="verdict" class="text-[15px]" :class="verdict.tone">
      {{ verdict.detail }}
    </p>

    <!-- Per category, as money now: the same chips, the same drill-down. -->
    <div v-if="summary.by_category.length" class="flex flex-col gap-1 border-t border-line pt-3">
      <NuxtLink
        v-for="category in summary.by_category"
        :key="category.category_id"
        :to="`/konobar/moja-smjena/stavke?kat=${category.category_id}`"
        class="flex min-h-12 items-center justify-between gap-3 text-[17px]"
      >
        <span class="text-text-2">{{ category.name ?? categoryNames.get(category.category_id) ?? '—' }}</span>
        <span class="flex items-center gap-3">
          <span class="num text-text-2">{{ category.qty }}</span>
          <span class="num font-semibold">{{ formatKm(category.fen) }}</span>
        </span>
      </NuxtLink>
    </div>

    <div class="flex flex-col gap-1 border-t border-line pt-3 text-[15px] text-text-2">
      <div v-if="summary.storno.count" class="flex justify-between gap-3">
        <span>Storna</span>
        <span class="num">{{ summary.storno.count }} · {{ formatKm(summary.storno.fen) }}</span>
      </div>
      <div v-if="summary.gratis.count" class="flex justify-between gap-3">
        <span>Na račun kuće</span>
        <span class="num">{{ summary.gratis.count }} · {{ formatKm(summary.gratis.fen) }}</span>
      </div>
      <div v-if="summary.unpaid_fen" class="flex justify-between gap-3">
        <span>Nije plaćeno (čeka vlasnika)</span>
        <span class="num">{{ formatKm(summary.unpaid_fen) }}</span>
      </div>
      <div class="flex justify-between gap-3">
        <span>Ture · stolovi · lule</span>
        <span class="num">{{ summary.rounds }} · {{ summary.tabs }} · {{ summary.bowls }}</span>
      </div>
    </div>

    <p v-if="settlement && !settlement.accepted_by_name" class="text-[15px] text-text-2">
      Predao si sam; vlasnik potvrđuje kasnije.
    </p>
    <p v-else-if="settlement" class="text-[15px] text-text-2">
      Primio: {{ settlement.accepted_by_name }}
    </p>
  </section>
</template>
