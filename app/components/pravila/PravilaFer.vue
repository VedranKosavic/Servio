<script setup lang="ts">
/**
 * The part of *Pravila* that is not a number: the fairness contract.
 *
 * These sections are **not** part of the published document and cannot be
 * edited away from `/a`. They are the promises the app itself makes — what a
 * flag means, what is recorded, who can see what — and PLAN §8 and F12 put them
 * in *Pravila* precisely so that they are not the owner's to soften. The
 * honesty note about the database file is quoted word for word from F12 (a).
 *
 * The one thing that is interpolated inside the note is how long a photo lives:
 * `chat_retention_days` is a setting, and a note that said "90 dana" while the
 * server deleted at 60 would be the exact dishonesty the note exists to
 * prevent. With the default 90 the sentence reads exactly as PLAN writes it.
 *
 * Dark theme: a `/k` component, no `/a` token anywhere in it.
 */
import type { Settings } from '#shared/settings'

const props = defineProps<{ settings: Settings | null }>()

function value(key: keyof Settings): string {
  return props.settings ? formatSetting(key, props.settings) : ''
}

const photoDays = computed(() => value('chat_retention_days') || '90 dana')
const deleteWindow = computed(() => value('chat_delete_own_s') || '15 minuta')
</script>

<template>
  <section class="card flex flex-col gap-2 p-4">
    <h2 class="text-xl font-bold">
      Šta znači „označeno za razgovor“
    </h2>
    <p class="text-[15px] text-text-2">
      Kad nešto pređe prag odozgo, Šank to označi i vlasnik pogleda. To nije
      optužba i ne ide nikome osim vlasniku: nema poruka, nema obavještenja,
      nema liste najboljih ni najgorih. Manjak od pet maraka u petak uveče je
      stavka za razgovor, ne presuda.
    </p>
    <p class="text-[15px] text-text-2">
      Žuto znači razgovor. Crveno tek poslije tri označene smjene u 30 dana — i
      svaka oznaka dobije ishod: razgovarano · OK, opomena ili greška
      aplikacije. Ishod „OK“ ispada iz brojanja i vidiš ga na svom redu.
    </p>
    <p class="text-[15px] text-text-2">
      Svoje brojeve vidiš prvi i vidiš sve — tuđe ne vidiš nikad.
    </p>
  </section>

  <section class="card flex flex-col gap-2 p-4">
    <h2 class="text-xl font-bold">
      Šta aplikacija bilježi
    </h2>
    <p class="text-[15px] text-text-2">
      Zapisuju se ture, naplate, storna, gratis, otpisi, popisi, prijave i
      predaje pazara — svaka sa tvojim imenom, uređajem i vremenom. Ne bilježi
      se lokacija, ne čitaju se kontakti, i kamera se otvara samo kad ti
      pritisneš <span class="text-text">Slikaj</span>.
    </p>
    <ul class="list-disc space-y-1 pl-5 text-[15px] text-text-2">
      <li>Svoje brojeve vidiš ti; kolegine ne vidi niko osim vlasnika.</li>
      <li>Slika se ponovo snima pri slanju, pa se GPS i podaci o telefonu iz nje gube.</li>
      <li>Tekst u razgovoru se briše nakon 12 mjeseci, slike nakon {{ photoDays }}.</li>
      <li>Svoju poruku brišeš sam u prvih {{ deleteWindow }}.</li>
      <li>
        Ko je šta pročitao aplikacija pamti samo da bi brojala nepročitane
        poruke — to se ne vidi ni na jednom ekranu i nema „viđeno“.
      </li>
      <li>Bolovanje i izostanak vidi samo vlasnik.</li>
    </ul>
  </section>

  <section class="card flex flex-col gap-2 p-4">
    <h2 class="text-xl font-bold">
      Kanal Konobari, pošteno
    </h2>
    <p class="text-[15px] text-text-2">
      Vlasnik u aplikaciji ne vidi kanal Konobari i ne može ga otvoriti. Poruke
      su ipak zapisane u bazi na serveru, kao i sve ostalo; bazu mogu otvoriti
      vlasnik i Vedran. Kanal nije tajan — samo nije na vlasnikovom ekranu. Ne
      pišite ništa što ne biste rekli naglas. Poruke se brišu nakon 12 mjeseci,
      slike nakon {{ photoDays }}; kopije u sigurnosnim kopijama žive još do 60
      dana. Obrisana slika nestaje sa servera odmah, sa telefona do sat vremena
      kasnije; original ostaje u galeriji onome ko ju je slikao. Ko je šta
      pročitao aplikacija pamti samo da bi brojala nepročitane poruke — niko to
      ne vidi na ekranu.
    </p>
    <p class="text-[15px] text-text-2">
      Vlasnikovo obećanje da bazu neće otvarati je pravilo koje piše ovdje, a ne
      kod u aplikaciji. Piše zato što je istina, a ne zato što je lijepo.
    </p>
    <p class="text-[15px] text-text-2">
      Slike u razgovoru ostaju na serveru lokala i ne idu nigdje van njega.
    </p>
  </section>

  <section class="card flex flex-col gap-2 p-4">
    <h2 class="text-xl font-bold">
      Razgovor i slike
    </h2>
    <ul class="list-disc space-y-1 pl-5 text-[15px] text-text-2">
      <li>Slike samo šanka, robe i prostora — gosti nikad.</li>
      <li>Šta napišeš u Konobarima kolega može proslijediti.</li>
      <li>Sliku u Konobarima može ukloniti svako; tekst samo autor.</li>
      <li>Ničiji pazar, manjak ili razlika ne ide u Svi ni u Konobare — ni kao slika.</li>
      <li>Vlasnik ne pravi naloge koje sam koristi.</li>
    </ul>
  </section>

  <section class="card flex flex-col gap-2 p-4">
    <h2 class="text-xl font-bold">
      Šta se zapisuje
    </h2>
    <p class="text-[15px] text-text-2">
      Svaka tura, naplata, storno i otpis zapisuju se s tvojim imenom i
      vremenom, i ne brišu se — ispravka je novi zapis pored starog, nikad
      umjesto njega.
    </p>
    <p class="text-[15px] text-text-2">
      Sve to stoji u jednoj bazi na serveru lokala. Vlasnik ima pristup toj
      datoteci i tehnički može vidjeti sve što je u njoj. To piše ovdje zato što
      je istina, a ne zato što je lijepo — aplikacija koja bi to prećutala ne bi
      bila poštenija, samo tiša.
    </p>
  </section>
</template>
