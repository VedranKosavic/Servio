<script setup lang="ts">
/**
 * *Kontrolna ploča* — one door to everything the owner may change.
 *
 * A list of links and nothing else: every row opens the screen that already
 * owns that table, so there is one way to edit a price, not two. The rows come
 * from `app/utils/kontrola.ts`. Live sync is not this page's job — each screen
 * behind a row listens to the change feed itself.
 */
import { KONTROLA } from '~/utils/kontrola'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Kontrolna ploča' })
</script>

<template>
  <div class="a-page">
    <UiPageHead title="Kontrolna ploča" sub="Osoblje, meni, zaliha, stolovi i postavke" />

    <UiCard v-for="section in KONTROLA" :key="section.id" :title="section.title">
      <p v-if="section.note" class="k-note">{{ section.note }}</p>

      <template v-for="link in section.links" :key="link.id">
        <span v-if="!link.ready" class="k-row k-soon">
          <span class="k-text">
            <strong>{{ link.label }}</strong>
            <small>{{ link.sub }}</small>
          </span>
          <UiPill tone="neutral">{{ link.soon }}</UiPill>
        </span>
        <NuxtLink v-else :to="link.to" class="k-row">
          <span class="k-text">
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

.k-note {
  margin: 0 0 4px;
  color: var(--muted);
  font-size: var(--text-micro);
}

/* The same row as *Više*: a 56 px target, the label talking, a chevron. */
.k-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 8px 0;
  border-bottom: 1px solid var(--surface-2);
  color: var(--ink);
  text-decoration: none;
}

.k-row:last-child { border-bottom: 0; }
.k-soon { opacity: 0.5; }
.k-text { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.k-text small { color: var(--muted); font-size: var(--text-micro); }
</style>
