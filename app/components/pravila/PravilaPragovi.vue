<script setup lang="ts">
/**
 * The published thresholds — every number a person is measured against, in the
 * order somebody meets them during a shift.
 *
 * They are drawn from `me.venue.settings` and not from the published text, so
 * the day the owner changes the cash tolerance in *Podešavanja* the number here
 * changes on every phone without a new version of *Pravila*. The document above
 * this list may quote the same numbers with `{{cash_tolerance_fen}}`, which is
 * the same value through the same formatter.
 *
 * Dark theme: this is a `/konobar` component and writes no `/admin` token.
 */
import type { Settings } from '#shared/settings'

const props = defineProps<{ settings: Settings | null }>()

/** `formatSetting` is `app/utils/markdownish.ts`'s, auto-imported by Nuxt. */
function value(key: keyof Settings): string {
  return props.settings ? formatSetting(key, props.settings) : ''
}

const rules = computed(() => {
  const s = props.settings
  if (!s) return []
  return [
    {
      title: 'Vlastiti storno',
      value: value('void_self_window_s'),
      detail: `Grešku na svojoj turi ispravljaš sam u prvih ${value('void_self_window_s')} od zaključavanja. `
        + `Najviše ${value('self_void_max_per_shift')} puta po smjeni i do ${value('self_void_max_fen')} po stavci.`,
    },
    {
      title: 'Storno preko šankera',
      value: value('bartender_approve_window_s'),
      detail: 'Poslije toga o storno odlučuje vlasnik. Dok se ne odobri, iznos ostaje u tvom pazaru — '
        + 'nije kazna, nego stanje: roba je izdata i nije naplaćena.',
    },
    {
      title: 'Na račun kuće — osoblje',
      value: `${value('staff_drinks_per_shift')} po smjeni`,
      detail: `Do ${value('staff_drink_max_fen')} po piću, i samo za pića koja su na spisku. `
        + 'Sve ostalo se zaključava po punoj cijeni i neko odlučuje.',
    },
    {
      title: 'Tolerancija pazara',
      value: value('cash_tolerance_fen'),
      detail: `Razlika do ${value('cash_tolerance_fen')} ili ${value('cash_tolerance_pct')} `
        + 'očekivanog iznosa je u toleranciji. Iznad toga se stavka označava za razgovor.',
    },
    {
      title: 'Otpis traži PIN',
      value: value('waste_pin_threshold_fen'),
      detail: `Otpis iznad ${value('waste_pin_threshold_fen')} potvrđuje šanker ili vlasnik svojim PIN-om. `
        + `Najviše ${value('waste_events_per_shift_per_user')} otpisa po osobi po smjeni.`,
    },
    {
      title: 'Kašnjenje',
      value: value('roster_late_grace_min'),
      detail: `Prva akcija poslije početka smjene preko ${value('roster_late_grace_min')} se ispiše u Satima. `
        + 'Prva akcija nije dolazak — to je podatak za razgovor, ne oznaka.',
    },
    {
      title: 'Zajednički uređaj',
      value: value('shared_device_idle_s'),
      detail: `Tablet na šanku se sam zaključa nakon ${value('shared_device_idle_s')} bez dodira. `
        + 'Tuđi telefon možeš koristiti ako kažeš da ga posuđuješ — prijava tada traje 2 sata.',
    },
  ]
})
</script>

<template>
  <section v-if="rules.length" class="card flex flex-col px-4">
    <div
      v-for="rule in rules"
      :key="rule.title"
      class="flex flex-col gap-1 border-t border-line py-3 first:border-t-0 first:pt-0"
    >
      <div class="flex items-baseline justify-between gap-3">
        <span class="text-body font-semibold">{{ rule.title }}</span>
        <span class="num shrink-0 font-bold text-accent-text">{{ rule.value }}</span>
      </div>
      <p class="text-label text-text-2">
        {{ rule.detail }}
      </p>
    </div>
  </section>

  <p v-else class="card px-4 py-8 text-center text-text-2">
    Pragovi stižu s prijavom — otvori ekran ponovo kad budeš prijavljen.
  </p>
</template>
