<script setup lang="ts">
/**
 * The kitchen sink: every component of the `/a` kit on one page.
 *
 * **Development only.** It 404s in a production build, so it is not a screen the
 * owner can wander into — it exists so that a change to `UiTable` or `UiButton`
 * can be looked at in a browser at 1440 px and at 390 px without opening five
 * real pages, and so WP1–WP5 can see what they are building with.
 */
definePageMeta({ middleware: 'admin', layout: 'admin' })

if (!import.meta.dev) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}

useHead({ title: 'Kit' })

const seg = ref('vazno')
const text = ref('Zvečevo d.o.o.')
const money = ref<number | null>(1250)
const qty = ref<number | null>(2.5)
const sheetOpen = ref(false)

/** One made-up attention row, shaped exactly like the server's. */
const attention = {
  kind: 'void' as const,
  ref_type: 'line_adjustment' as const,
  ref_id: '3f9a1c22-0000-4000-8000-000000000001',
  title_bs: 'Traži storno · Dino · Sto 9 · Nargila 12,00 KM',
  amount_fen: 1200,
  at: new Date(Date.now() - 42 * 60_000).toISOString(),
  actions: ['approve', 'reject', 'note'] as const,
}

const columns = [
  { key: 'konobar', label: 'Konobar' },
  { key: 'promet', label: 'Promet', align: 'r' as const },
  { key: 'razlika', label: 'Razlika', align: 'r' as const },
  { key: 'ocjena', label: 'Ocjena' },
]

const rows = [
  { name: 'Amar', promet: 61250, razlika: -400, tone: 'good' as const, word: 'u toleranciji' },
  { name: 'Lejla', promet: 54000, razlika: 0, tone: 'good' as const, word: 'u toleranciji' },
  { name: 'Dino', promet: 46000, razlika: -1200, tone: 'warn' as const, word: 'označeno za razgovor' },
]
</script>

<template>
  <div class="a-page">
    <header class="a-page-head">
      <h1>Kit</h1>
      <p class="a-page-sub">Samo u razvoju — pregled komponenti</p>
    </header>

    <div class="a-tiles">
      <UiTile label="Promet danas" :value="formatKm(128400)" sub="118 naplaćenih stolova" />
      <UiTile label="Otvoreno" value="7" sub="stolova · 145,50 KM" />
      <UiTile label="Razlika gotovine" :value="signedKm(-400)" sub="u toleranciji" tone="warn" />
      <UiTile label="Manjak robe" :value="formatKm(620)" tone="bad" />
    </div>

    <UiCard title="Zahtijeva pažnju" :count="1">
      <UiAttentionRow :item="attention" @act="() => {}" />
    </UiCard>

    <UiCard title="Po konobaru" count="3 osobe">
      <UiTable :columns="columns">
        <tr v-for="row in rows" :key="row.name">
          <td>{{ row.name }}</td>
          <td class="r"><UiMoney :fen="row.promet" :currency="false" :colour="false" /></td>
          <td class="r"><UiMoney :fen="row.razlika" :currency="false" /></td>
          <td><UiPill :tone="row.tone">{{ row.word }}</UiPill></td>
        </tr>
      </UiTable>
    </UiCard>

    <UiCard title="Dugmad i kontrole">
      <div class="a-row">
        <UiButton variant="primary">Odobri</UiButton>
        <UiButton variant="ghost">Bilješka</UiButton>
        <UiButton variant="soft">Primijeni</UiButton>
        <UiButton variant="danger">Odbij</UiButton>
        <UiButton variant="primary" pending>Šalje se</UiButton>
      </div>

      <div class="a-row">
        <UiPill tone="good">u toleranciji</UiPill>
        <UiPill tone="warn">na čekanju</UiPill>
        <UiPill tone="bad">u minusu</UiPill>
        <UiPill tone="neutral">zatvorena</UiPill>
        <UiPill tone="accent">otvorena</UiPill>
      </div>

      <UiSeg
        v-model="seg"
        label="Filter"
        :options="[{ value: 'vazno', label: 'Važno' }, { value: 'sve', label: 'Sve' }]"
      />

      <div class="a-row">
        <UiButton variant="ghost" @click="sheetOpen = true">Otvori panel</UiButton>
      </div>
    </UiCard>

    <UiCard title="Period">
      <UiPeriod />
    </UiCard>

    <UiCard title="Polja">
      <div class="a-grid">
        <UiField v-model="text" label="Dobavljač" placeholder="Ime dobavljača" />
        <UiField v-model="money" label="Cijena" kind="money" hint="Unosi se u KM" />
        <UiField v-model="qty" label="Količina" kind="decimal" />
        <UiField v-model="text" label="Napomena" error="Napomena je obavezna" />
      </div>
    </UiCard>

    <UiCard title="Novac">
      <p class="a-row">
        <UiMoney :fen="125050" /> · <UiMoney :fen="-400" /> · <UiMoney :fen="0" />
      </p>
      <p class="a-muted">
        {{ dateBs('2026-09-08') }} · {{ dateTimeBs(attention.at) }} · {{ durationBs(22_080) }}
      </p>
    </UiCard>

    <UiSheet
      :open="sheetOpen"
      title="Sto 7 · narudžba"
      action="Zatvori"
      @close="sheetOpen = false"
      @confirm="sheetOpen = false"
    >
      <p class="a-muted">Panel je odozdo na telefonu, u sredini na laptopu.</p>
      <UiField v-model="text" label="Bilješka" kind="textarea" />
    </UiSheet>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 18px; min-width: 0; }

.a-page-head h1 {
  font-family: var(--font-title);
  font-weight: 700;
  font-size: 28px;
  letter-spacing: -0.015em;
  margin: 0;
}

.a-page-sub { margin: 0; color: var(--muted); font-size: 14px; }
.a-muted { margin: 0; color: var(--muted); }

.a-tiles {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.a-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0; }

.a-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 1023px) {
  /* Two-up on a phone, which is what the mockup does with the six Puls tiles. */
  .a-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .a-grid { grid-template-columns: 1fr; }
}
</style>
