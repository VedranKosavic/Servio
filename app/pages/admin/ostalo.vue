<script setup lang="ts">
/**
 * `/admin/ostalo` — the five screens a café needs a few times a year.
 *
 * **Why this page exists.** *Podešavanja*, *Pravila*, *Stolovi*, *Dnevnik* and
 * *Izvoz* each used to hold a row in the nav or a chip in the *Meni i postavke*
 * strip. Between them they made the nav eight rows and that strip eight tabs,
 * and on a 390 px phone — which is where this dashboard is used almost all of
 * the time — neither could be read at a glance. The owner asked for them out of
 * the way.
 *
 * Out of the way is not gone, and the difference matters for two of them.
 * *Podešavanja* holds the thresholds every manjak flag is measured against, so
 * deleting it would leave the anti-theft rules set in stone at whatever they
 * happen to be. *Pravila* is the published page staff acknowledge — PLAN §8's
 * whole accountability argument is that the thresholds are visible to the people
 * they judge, and an unpublishable *Pravila* quietly turns that into
 * surveillance. Both keep working; they are just no longer two of the first
 * things anybody sees.
 *
 * The order is how often a café actually opens them.
 */
definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Ostalo' })

const changes = useAdminChanges()

const links: Array<{ to: string, label: string, sub: string }> = [
  { to: '/admin/izvoz', label: 'Izvoz', sub: 'CSV fajlovi za period — za knjigovođu' },
  { to: '/admin/dnevnik', label: 'Dnevnik', sub: 'Ko je šta uradio, po danima' },
  { to: '/admin/postavke', label: 'Podešavanja', sub: 'Pragovi po kojima lokal radi' },
  { to: '/admin/postavke/pravila', label: 'Pravila', sub: 'Šta osoblje vidi i potvrđuje' },
  { to: '/admin/postavke/stolovi', label: 'Stolovi', sub: 'Raspored stolova po zonama' },
  { to: '/admin/postavke/sabloni', label: 'Šabloni smjena', sub: 'Smjene od kojih se gradi sedmica' },
]
</script>

<template>
  <div class="a-page">
    <UiPageHead title="Ostalo" sub="Rijetko, ali kad zatreba" />

    <UiCard>
      <NuxtLink v-for="link in links" :key="link.to" :to="link.to" class="o-row">
        <span class="o-text">
          <strong>{{ link.label }}</strong>
          <small>{{ link.sub }}</small>
        </span>
        <UiPill v-if="link.to === '/admin/dnevnik' && changes.logUnread.value" tone="bad">novo</UiPill>
        <UiIcon name="chevron-right" :size="20" />
      </NuxtLink>
    </UiCard>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

.o-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 8px 0;
  border-bottom: 1px solid var(--surface-2);
  color: var(--ink);
  text-decoration: none;
}

.o-row:last-child { border-bottom: 0; }
.o-text { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.o-text small { color: var(--muted); font-size: var(--text-micro); }
</style>
