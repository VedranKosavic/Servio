<script setup lang="ts">
/**
 * The six tiles across the top of *Puls*, in the mockup's order.
 *
 * All six read one object — `GET /api/owner/live` — and none of them formats a
 * number itself: every amount goes through `formatAmount` / `formatKm`, which
 * are `shared/money.ts`'s and are the same functions the server uses to write
 * an amount into a Dnevnik title, so a figure here and the same figure there
 * can never disagree.
 *
 * The widths are the mockup's: *Ko radi* is more than twice a plain tile
 * because it holds names, and the two count tiles are narrower than the money
 * ones. Below 1024 px the row becomes two columns and the ratios go away.
 */
import type { OwnerLive } from '#shared/types'

const props = defineProps<{ live: OwnerLive }>()

/** "7 stolova · 145,50 KM" — the open tables and what is still on them. */
const openSub = computed(() => {
  const { tables, total_fen } = props.live.open
  return `${stolovaBs(tables)} · ${formatKm(total_fen)}`
})

/** "9,50 / 6,00 KM" — the two amounts under the two counts. */
const adjustmentsSub = computed(() =>
  `${formatAmount(props.live.storna.fen)} / ${formatKm(props.live.gratis.fen)}`)

/**
 * The unit used to be the whole second line ("86,00" with "KM" under it), which
 * read as two facts where there is one. The unit now sits beside the number and
 * the line under it says something the number does not.
 */
const prometSub = computed(() => props.live.shift
  ? 'naplaćeno u ovoj smjeni'
  : 'smjena još nije otvorena')

const cashSub = computed(() => props.live.expected_cash_fen < 0
  ? 'iz kase je izašlo više nego što je ušlo'
  : 'koliko bi trebalo biti u kasi')

/**
 * A drawer that owes money is red and says so.
 *
 * `expected_cash_fen` goes negative when more has been paid out of the till
 * than has come into it — a 60,00 KM payout early in a quiet evening does it —
 * and that is a number the owner should not have to squint at.
 */
const cashTone = computed<'plain' | 'bad'>(() =>
  props.live.expected_cash_fen < 0 ? 'bad' : 'plain')

const unsentSub = computed(() => props.live.unsent.length
  ? props.live.unsent.map(device => device.label).join(' · ')
  : 'svi telefoni sinhronizovani')

/** Amber only while a phone is actually holding rounds; plain the rest of the night. */
const unsentTone = computed<'plain' | 'warn'>(() =>
  props.live.unsent.length ? 'warn' : 'plain')
</script>

<template>
  <div class="a-tiles">
    <!-- `signedAmount` and not `formatAmount`: the real minus sign (U+2212) is
         as wide as a digit, so a column of tabular figures keeps its alignment
         where an ASCII hyphen would break it. -->
    <UiTile
      label="Promet danas"
      :value="signedAmount(live.promet_danas_fen)"
      unit="KM"
      :sub="prometSub"
    />

    <UiTile label="Otvoreno" :value="live.open.tables" :sub="openSub" />

    <UiTile
      label="Gotovina očekivano"
      :value="signedAmount(live.expected_cash_fen)"
      unit="KM"
      :sub="cashSub"
      :tone="cashTone"
    />

    <UiTile
      label="Storna i gratis"
      :value="`${live.storna.count} / ${live.gratis.count}`"
      :sub="adjustmentsSub"
    />

    <!-- A tile leads with the number (DESIGN §8). This one used to open with a
         line of names at body weight in the widest card of the row, so on a
         normal night it was a 320 × 140 box holding one word and the row lost
         the baseline the other five share. The count is the figure; the names
         and the two pills are the second line, which is where they belong. -->
    <UiTile label="Ko radi" :value="live.who.length">
      <template #sub>
        <PulsWhoStrip :who="live.who" :unsent="live.unsent" />
      </template>
    </UiTile>

    <UiTile
      label="Neposlano"
      :value="live.unsent.length"
      :sub="unsentSub"
      :tone="unsentTone"
    />
  </div>
</template>

<style scoped>
.a-tiles {
  display: grid;
  gap: 12px;
  grid-template-columns:
    minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1.2fr)
    minmax(0, 1fr) minmax(0, 2.1fr) minmax(0, 1.05fr);
}

@media (max-width: 1023px) {
  /* Two-up on a phone: six tiles in three rows, each still 84 px tall. */
  .a-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }

  /* The last two go full width: *Ko radi* holds names and *Neposlano* holds
     phone labels, both of which are sentences rather than figures. Spanning
     both also keeps the grid whole — five tiles two-up would leave a hole. */
  .a-tiles > :nth-child(5),
  .a-tiles > :nth-child(6) { grid-column: 1 / -1; }
}
</style>
