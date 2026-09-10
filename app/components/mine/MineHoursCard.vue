<script setup lang="ts">
/**
 * *Moji sati* — hours **worked**, and only those.
 *
 * There is no *planirano* column, and its absence is on purpose: the roster is
 * Phase 4, and a planned column filled with zeros would read as "you were
 * scheduled for nothing" rather than "nobody has told the app yet". A number
 * the app cannot know is left out, not defaulted (PHASE3 §3, WP4).
 *
 * Hours come from `shift_members.joined_at → left_at`, which is why *Odjavi se*
 * deliberately does not end a membership: a shared tablet handed across the bar
 * a dozen times must not end anybody's night at 21:40.
 */
import type { MyShiftRow } from '#shared/types'

const props = defineProps<{ rows: MyShiftRow[] }>()

const total = computed(() => props.rows.reduce((sum, r) => sum + r.hours, 0))
const nights = computed(() => props.rows.length)

function hoursText(hours: number): string {
  return `${hours.toFixed(1).replace('.', ',')} h`
}
</script>

<template>
  <section class="card flex flex-col gap-2 p-4">
    <h2 class="section-title">
      Moji sati
    </h2>

    <div class="grid grid-cols-2 gap-2">
      <div class="card-2 flex flex-col items-center justify-center gap-1.5 px-2 py-4">
        <span class="metric num">{{ hoursText(total) }}</span>
        <span class="eyebrow">ukupno</span>
      </div>
      <div class="card-2 flex flex-col items-center justify-center gap-1.5 px-2 py-4">
        <span class="metric num">{{ nights }}</span>
        <span class="eyebrow">{{ nights === 1 ? 'noć' : 'noći' }}</span>
      </div>
    </div>

    <p class="text-label text-text-2">
      Odrađeni sati, od prve zaključane ture do kraja smjene. Raspored stiže
      kasnije — dok ga nema, ovdje piše samo ono što se stvarno desilo.
    </p>
  </section>
</template>
