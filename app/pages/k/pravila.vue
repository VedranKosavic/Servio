<script setup lang="ts">
/**
 * S12 *Pravila* — the thresholds a person is measured against, written down.
 *
 * "Accountability, not surveillance" (CLAUDE.md) is only true if the numbers
 * are published. Every figure on this page is read from `me.venue.settings`,
 * which the phone already has — there is **no** `/api/rules` route and Phase 3
 * adds none (PHASE3 §1.12), and nothing here is acknowledged, signed or stored:
 * a rule you have to tick a box about is a contract, and this is a notice
 * board.
 *
 * Two sections that are not thresholds and matter more than the thresholds:
 * what *označeno za razgovor* actually means, and the honest paragraph about
 * the database file — which is in *Pravila* because it is true whether or not
 * anybody writes it down, and writing it down is the only version of it that
 * respects the person reading.
 */
import { formatKm } from '#shared/money'

useHead({ title: 'Pravila' })

const me = useMe()

onMounted(() => { void me.requireSession() })

const s = computed(() => me.settings.value)

function minutes(seconds: number): string {
  if (seconds < 60) return `${seconds} sekundi`
  const m = Math.round(seconds / 60)
  return m === 1 ? '1 minut' : `${m} minuta`
}

/** Every published number, in the order somebody meets them during a shift. */
const rules = computed(() => {
  const v = s.value
  if (!v) return []
  return [
    {
      title: 'Vlastiti storno',
      value: minutes(v.void_self_window_s),
      detail: `Grešku na svojoj turi ispravljaš sam u prvih ${minutes(v.void_self_window_s)} od zaključavanja. `
        + `Najviše ${v.self_void_max_per_shift} puta po smjeni i do ${formatKm(v.self_void_max_fen)} po stavci.`,
    },
    {
      title: 'Storno preko šankera',
      value: minutes(v.bartender_approve_window_s),
      detail: 'Poslije toga o storno odlučuje vlasnik. Dok se ne odobri, iznos ostaje u tvom pazaru — '
        + 'nije kazna, nego stanje: roba je izdata i nije naplaćena.',
    },
    {
      title: 'Na račun kuće — osoblje',
      value: `${v.staff_drinks_per_shift} po smjeni`,
      detail: `Do ${formatKm(v.staff_drink_max_fen)} po piću, i samo za pića koja su na spisku. `
        + 'Sve ostalo se zaključava po punoj cijeni i neko odlučuje.',
    },
    {
      title: 'Tolerancija pazara',
      value: formatKm(v.cash_tolerance_fen),
      detail: `Razlika do ${formatKm(v.cash_tolerance_fen)} ili ${String(v.cash_tolerance_pct).replace('.', ',')} % `
        + 'očekivanog iznosa je u toleranciji. Iznad toga se stavka označava za razgovor.',
    },
    {
      title: 'Otpis traži PIN',
      value: formatKm(v.waste_pin_threshold_fen),
      detail: `Otpis iznad ${formatKm(v.waste_pin_threshold_fen)} potvrđuje šanker ili vlasnik svojim PIN-om. `
        + `Najviše ${v.waste_events_per_shift_per_user} otpisa po osobi po smjeni.`,
    },
    {
      title: 'Zajednički uređaj',
      value: minutes(v.shared_device_idle_s),
      detail: `Šank tablet se sam zaključa nakon ${minutes(v.shared_device_idle_s)} bez dodira. `
        + 'Tuđi telefon možeš koristiti ako kažeš da ga posuđuješ — prijava tada traje 2 sata.',
    },
  ]
})
</script>

<template>
  <ClientOnly>
    <div class="flex flex-1 flex-col">
      <WaiterHeader title="Pravila" back-to="/k/moja-smjena">
        <template #right>
          <WaiterSyncChip compact />
        </template>
      </WaiterHeader>

      <main class="flex flex-1 flex-col gap-4 py-4">
        <p class="text-[17px] text-text-2">
          Ovo su brojevi po kojima se mjeri rad u ovom lokalu. Pišu ovdje zato
          što pravilo koje ne znaš unaprijed nije pravilo.
        </p>

        <section v-if="rules.length" class="card flex flex-col px-4">
          <div
            v-for="rule in rules"
            :key="rule.title"
            class="flex flex-col gap-1 border-t border-line py-3 first:border-t-0 first:pt-0"
          >
            <div class="flex items-baseline justify-between gap-3">
              <span class="text-[17px] font-semibold">{{ rule.title }}</span>
              <span class="num shrink-0 font-bold text-accent">{{ rule.value }}</span>
            </div>
            <p class="text-[15px] text-text-2">
              {{ rule.detail }}
            </p>
          </div>
        </section>

        <p v-else class="card px-4 py-8 text-center text-text-2">
          Pravila stižu s prijavom — otvori ekran ponovo kad budeš prijavljen.
        </p>

        <section class="card flex flex-col gap-2 p-4">
          <h2 class="text-xl font-bold">
            Označeno za razgovor
          </h2>
          <p class="text-[15px] text-text-2">
            Kad nešto pređe prag odozgo, Šank to označi i vlasnik pogleda. To
            nije optužba i ne ide nikome osim vlasniku: nema poruka, nema
            obavještenja, nema liste najboljih ni najgorih. Manjak od pet maraka
            u petak uveče je stavka za razgovor, ne presuda.
          </p>
          <p class="text-[15px] text-text-2">
            Svoje brojeve vidiš prvi i vidiš sve — tuđe ne vidiš nikad.
          </p>
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
            datoteci i tehnički može vidjeti sve što je u njoj. To piše ovdje
            zato što je istina, a ne zato što je lijepo — aplikacija koja bi to
            prećutala ne bi bila poštenija, samo tiša.
          </p>
        </section>
      </main>
    </div>

    <template #fallback>
      <p class="py-10 text-center text-text-2">
        Učitavanje…
      </p>
    </template>
  </ClientOnly>
</template>
