<script setup lang="ts">
/**
 * *Instalacija* — how a phone gets Šank onto its home screen, and the one
 * sentence about iOS that everything else depends on.
 *
 * **The cookie jar.** Safari and a home-screen web app on iOS do not share
 * cookies. The device cookie a phone gets when it enrols therefore does not
 * follow it out of Safari — so a phone that enrols in the browser and *then*
 * installs the app finds itself unenrolled, in front of an enrol screen,
 * usually at 21:00 with a full terrace. Install first, enrol inside.
 *
 * Android does not have this problem, but the instruction is the same and one
 * instruction is better than two.
 *
 * The three pictures are inline SVG, like every other icon in this app — a
 * screenshot would be a 300 kB asset that goes stale with the next iOS.
 */
useHead({ title: 'Instalacija' })

const me = useMe()
const { persisted } = useOutbox()

onMounted(() => {
  void me.requireSession()
})

/** Is this page already being read from inside the installed app? */
const standalone = ref(false)
/** iOS gets the three-step guide; everything else gets the browser's own prompt. */
const isIos = ref(false)

onMounted(() => {
  standalone.value = window.matchMedia?.('(display-mode: standalone)').matches === true
  isIos.value = /iphone|ipad|ipod/i.test(navigator.userAgent)
})
</script>

<template>
  <ClientOnly>
    <div class="flex flex-1 flex-col">
      <WaiterHeader title="Instalacija" back-to="/k">
        <template #right>
          <WaiterSyncChip />
        </template>
      </WaiterHeader>

      <div class="flex flex-1 flex-col gap-4 py-4">
        <div v-if="standalone" class="card flex items-center gap-3 border-good p-3">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-good">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          <p class="text-[15px]">
            <span class="font-semibold">Aplikacija je instalirana.</span>
            <span class="text-text-2"> Otvorena je s ikone, ne iz pregledača.</span>
          </p>
        </div>

        <p class="text-[17px] text-text-2">
          Instalirana aplikacija radi i bez interneta: narudžbe se čuvaju na telefonu i
          same odu čim se veza vrati.
        </p>

        <!-- The three steps -->
        <ol class="flex flex-col gap-3">
          <li class="card flex items-start gap-3 p-3">
            <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-accent">
              <!-- The iOS share glyph: a box with an arrow going up out of it. -->
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3v12" />
                <path d="M8 7l4-4 4 4" />
                <path d="M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6" />
              </svg>
            </span>
            <div>
              <div class="text-[17px] font-semibold">
                1 · Dodirni <span class="text-accent">Podijeli</span>
              </div>
              <p class="text-[15px] text-text-2">
                Dugme na dnu Safarija — kvadrat sa strelicom prema gore.
              </p>
            </div>
          </li>

          <li class="card flex items-start gap-3 p-3">
            <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-accent">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="4" />
                <path d="M12 8v8M8 12h8" />
              </svg>
            </span>
            <div>
              <div class="text-[17px] font-semibold">
                2 · <span class="text-accent">Dodaj na početni ekran</span>
              </div>
              <p class="text-[15px] text-text-2">
                U listi koja se otvori. Zatim <span class="text-text">Dodaj</span> gore desno.
              </p>
            </div>
          </li>

          <li class="card flex items-start gap-3 p-3">
            <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-accent">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 10.5L12 4l8 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1z" />
                <path d="M9.5 21v-6h5v6" />
              </svg>
            </span>
            <div>
              <div class="text-[17px] font-semibold">
                3 · Otvori s ikone
              </div>
              <p class="text-[15px] text-text-2">
                Ikona Šanka na početnom ekranu — ne više preko Safarija.
              </p>
            </div>
          </li>
        </ol>

        <!-- The sentence this whole page exists for. -->
        <div class="card border-warn p-3">
          <div class="mb-1 text-[17px] font-semibold text-warn">
            Prijavi telefon <span class="underline">unutar</span> aplikacije
          </div>
          <p class="text-[15px] text-text-2">
            Safari i aplikacija s početnog ekrana ne dijele prijavu. Ako telefon upišeš
            kodom u Safariju, a onda instaliraš aplikaciju, aplikacija te opet traži kod.
            Zato prvo instaliraj, pa tek onda upiši kod i PIN — u aplikaciji.
          </p>
        </div>

        <div class="card p-3">
          <div class="flex items-center gap-2">
            <span class="grow text-[17px]">Trajno spremanje</span>
            <span
              class="chip"
              :class="persisted === true ? 'chip-good' : persisted === false ? 'chip-warn' : ''"
            >
              {{ persisted === null ? 'nepoznato' : persisted ? 'uključeno' : 'isključeno' }}
            </span>
          </div>
          <p class="mt-1 text-[15px] text-text-2">
            Kad je uključeno, telefon neće sam obrisati sačuvane narudžbe kad ostane bez
            prostora.
          </p>
        </div>

        <p v-if="!isIos" class="text-center text-sm text-text-2">
          Na Androidu: meni pregledača → <span class="text-text">Instaliraj aplikaciju</span>.
        </p>
      </div>
    </div>

    <template #fallback>
      <p class="py-10 text-center text-text-2">
        Učitavanje…
      </p>
    </template>
  </ClientOnly>
</template>
