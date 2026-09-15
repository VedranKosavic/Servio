<script setup lang="ts">
/**
 * *Više* — the phone's fourth tab.
 *
 * The bottom bar holds three targets and *Više*; the rest of the dashboard lives
 * here. *Raspored* comes first, and under it everything that used to sit behind
 * the *Kontrolna ploča* row — the owner's call was one tap less: *Osoblje*,
 * *Uređaji*, *Meni*, *Kategorije*, *Stolovi*, *Šabloni smjena*, *Podešavanja*,
 * grouped exactly as the hub groups them (`app/utils/kontrola.ts`), so a row
 * added there lands here too. Every one of those screens goes back to *Više*
 * (`adminBack`).
 *
 * The *Kontrolna ploča* page itself stays for the laptop rail.
 */
import { KONTROLA } from '~/utils/kontrola'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Više' })

// The nav rows the bottom bar has no room for, less the hub whose rows are
// drawn below in full.
const links = adminMore().filter(link => link.id !== 'kontrola')
</script>

<template>
  <div class="a-page">
    <UiPageHead title="Više" sub="Ostatak kontrolne ploče" />

    <UiCard>
      <template v-for="link in links" :key="link.id">
        <span v-if="!link.ready" class="a-more-row a-more-soon">
          <span class="a-more-text">
            <strong>{{ link.label }}</strong>
            <small>{{ link.sub }}</small>
          </span>
          <UiPill tone="neutral">{{ link.soon }}</UiPill>
        </span>
        <NuxtLink v-else :to="link.to" class="a-more-row">
          <span class="a-more-text">
            <strong>{{ link.label }}</strong>
            <small>{{ link.sub }}</small>
          </span>
          <UiIcon name="chevron-right" :size="20" />
        </NuxtLink>
      </template>
    </UiCard>

    <UiCard v-for="section in KONTROLA" :key="section.id" :title="section.title">
      <p v-if="section.note" class="a-more-note">{{ section.note }}</p>
      <template v-for="link in section.links" :key="link.id">
        <span v-if="!link.ready" class="a-more-row a-more-soon">
          <span class="a-more-text">
            <strong>{{ link.label }}</strong>
            <small>{{ link.sub }}</small>
          </span>
          <UiPill tone="neutral">{{ link.soon }}</UiPill>
        </span>
        <NuxtLink v-else :to="link.to" class="a-more-row">
          <span class="a-more-text">
            <strong>{{ link.label }}</strong>
            <small>{{ link.sub }}</small>
          </span>
          <UiIcon name="chevron-right" :size="20" />
        </NuxtLink>
      </template>
    </UiCard>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

.a-more-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 8px 0;
  border-bottom: 1px solid var(--surface-2);
  color: var(--ink);
  text-decoration: none;
}

.a-more-row:last-child { border-bottom: 0; }
.a-more-soon { opacity: 0.5; }
.a-more-text { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.a-more-text small { color: var(--muted); font-size: var(--text-micro); }
.a-more-note { margin: 0 0 4px; color: var(--muted); font-size: var(--text-micro); }
</style>
