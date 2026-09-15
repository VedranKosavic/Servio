<script setup lang="ts">
/**
 * The part of *Pravila* that is not a number: the fairness contract.
 *
 * These sections are **not** part of the published document and cannot be
 * edited away from `/admin`. They are the promises the app itself makes — what a
 * flag means, what is recorded, who can see what — and PLAN §8 puts them in
 * *Pravila* precisely so that they are not the owner's to soften. The honesty
 * note about the database file is the last section.
 *
 * *Razgovor* was removed on the owner's call (15.09.2026), and with it every
 * sentence here about channels, messages and chat photos.
 *
 * Dark theme: a `/konobar` component, no `/admin` token anywhere in it.
 */
import type { Settings } from '#shared/settings'

defineProps<{ settings: Settings | null }>()
</script>

<template>
  <section class="card flex flex-col gap-2 p-4">
    <h2 class="section-title">
      Šta znači „označeno za razgovor“
    </h2>
    <p class="text-label text-text-2">
      Kad nešto pređe prag odozgo, {{ APP_NAME }} to označi i vlasnik pogleda. To nije
      optužba i ne ide nikome osim vlasniku: nema poruka, nema obavještenja,
      nema liste najboljih ni najgorih. Manjak od pet maraka u petak uveče je
      stavka za razgovor, ne presuda.
    </p>
    <p class="text-label text-text-2">
      Žuto znači razgovor. Crveno tek poslije tri označene smjene u 30 dana — i
      svaka oznaka dobije ishod: razgovarano · OK, opomena ili greška
      aplikacije. Ishod „OK“ ispada iz brojanja i vidiš ga na svom redu.
    </p>
    <p class="text-label text-text-2">
      Svoje brojeve vidiš prvi i vidiš sve — tuđe ne vidiš nikad.
    </p>
  </section>

  <section class="card flex flex-col gap-2 p-4">
    <h2 class="section-title">
      Šta aplikacija bilježi
    </h2>
    <p class="text-label text-text-2">
      Zapisuju se ture, naplate, storna, gratis, otpisi, popisi, prijave i
      predaje pazara — svaka sa tvojim imenom, uređajem i vremenom. Ne bilježi
      se lokacija i ne čitaju se kontakti.
    </p>
    <ul class="list-disc space-y-1 pl-5 text-label text-text-2">
      <li>Svoje brojeve vidiš ti; kolegine ne vidi niko osim vlasnika.</li>
      <li>Vlasnik ne pravi naloge koje sam koristi.</li>
    </ul>
  </section>

  <section class="card flex flex-col gap-2 p-4">
    <h2 class="section-title">
      Šta se zapisuje
    </h2>
    <p class="text-label text-text-2">
      Svaka tura, naplata, storno i otpis zapisuju se s tvojim imenom i
      vremenom, i ne brišu se — ispravka je novi zapis pored starog, nikad
      umjesto njega.
    </p>
    <p class="text-label text-text-2">
      Sve to stoji u jednoj bazi na serveru lokala. Vlasnik ima pristup toj
      datoteci i tehnički može vidjeti sve što je u njoj. To piše ovdje zato što
      je istina, a ne zato što je lijepo — aplikacija koja bi to prećutala ne bi
      bila poštenija, samo tiša.
    </p>
  </section>
</template>
