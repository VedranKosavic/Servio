<script setup lang="ts">
/**
 * *Moja smjena* before the envelope is handed in — the counts, and no money.
 *
 * This card is the answer to a real complaint about the old screen: for the
 * first five hours of every shift it was empty, because `GET /api/me/shift`
 * withholds the summary until a settlement row exists. Blindness is about what
 * the night *earned*, never about what a person *did* — so PHASE3 §1.5 puts a
 * `counts` block on that read carrying no `*_fen` key at all, and this renders
 * it.
 *
 * The one number here that looks like money is not his: *Osoblje 1/2 (do 3,00
 * KM)* is the published rule, the same ceiling written in *Pravila*. A rule you
 * are measured against has to be readable before you are measured.
 */
import { formatKm } from '#shared/money'
import type { MyShiftCounts } from '#shared/types'

defineProps<{
  counts: MyShiftCounts
  /** *"Trajno spremanje: uključeno"* — what the browser answered (WP0, §2.4). */
  persisted?: boolean | null
}>()

/** 1,25 h → "1,3 h". One decimal is as precise as anybody's memory of a shift. */
function hoursText(hours: number): string {
  return `${hours.toFixed(1).replace('.', ',')} h`
}
</script>

<template>
  <section class="card flex flex-col gap-3 p-4">
    <h2 class="text-xl font-bold">
      Večeras
    </h2>

    <div class="grid grid-cols-3 gap-2">
      <div class="card-2 flex flex-col items-center gap-0.5 px-2 py-3">
        <span class="num text-2xl font-bold">{{ counts.rounds }}</span>
        <span class="text-sm text-text-2">ture</span>
      </div>
      <div class="card-2 flex flex-col items-center gap-0.5 px-2 py-3">
        <span class="num text-2xl font-bold">{{ counts.tabs }}</span>
        <span class="text-sm text-text-2">stolovi</span>
      </div>
      <div class="card-2 flex flex-col items-center gap-0.5 px-2 py-3">
        <span class="num text-2xl font-bold">{{ counts.bowls }}</span>
        <span class="text-sm text-text-2">lule</span>
      </div>
    </div>

    <!-- Category chips. Each one opens the lines behind it. -->
    <div v-if="counts.by_category.length" class="flex flex-wrap gap-2">
      <NuxtLink
        v-for="category in counts.by_category"
        :key="category.category_id"
        :to="`/konobar/moja-smjena/stavke?kat=${category.category_id}`"
        class="chip min-h-12 gap-2 px-3.5 text-base"
      >
        <span>{{ category.name }}</span>
        <span class="num font-bold text-text">{{ category.count }}</span>
      </NuxtLink>
    </div>
    <p v-else class="text-[15px] text-text-2">
      Još nijedna tura večeras.
    </p>

    <div class="flex flex-col gap-1.5 border-t border-line pt-3 text-[17px]">
      <NuxtLink
        to="/konobar/moja-smjena/stavke?kat=storno"
        class="flex min-h-12 items-center justify-between gap-3"
      >
        <span class="text-text-2">Storna</span>
        <span class="flex items-center gap-2">
          <span v-if="counts.storno.pending" class="chip chip-warn">
            {{ counts.storno.pending }} čeka odobrenje
          </span>
          <span class="num font-semibold">{{ counts.storno.applied }}</span>
        </span>
      </NuxtLink>

      <div class="flex min-h-12 items-center justify-between gap-3">
        <span class="text-text-2">Osoblje</span>
        <span class="flex items-center gap-2">
          <span class="text-[15px] text-text-2">do {{ formatKm(counts.gratis.max_fen) }}</span>
          <span
            class="num font-semibold"
            :class="counts.gratis.used >= counts.gratis.cap ? 'text-warn' : ''"
          >{{ counts.gratis.used }}/{{ counts.gratis.cap }}</span>
        </span>
      </div>

      <div class="flex min-h-12 items-center justify-between gap-3">
        <span class="text-text-2">Otpis</span>
        <span class="num font-semibold">{{ counts.waste }}</span>
      </div>

      <div class="flex min-h-12 items-center justify-between gap-3">
        <span class="text-text-2">Sati</span>
        <span class="num font-semibold">{{ hoursText(counts.hours) }}</span>
      </div>

      <!-- WP0 asks the browser once, after the first PIN login (§2.4). -->
      <div v-if="persisted !== null" class="flex min-h-12 items-center justify-between gap-3">
        <span class="text-text-2">Trajno spremanje</span>
        <span
          class="chip"
          :class="persisted ? 'chip-good' : 'chip-warn'"
        >{{ persisted ? 'uključeno' : 'isključeno' }}</span>
      </div>
    </div>

    <p class="text-[15px] text-text-2">
      Pazar vidiš tek kad ga predaš — prebrojiš pa upišeš, i tek onda ti Šank
      kaže koliko je očekivao.
    </p>
  </section>
</template>
