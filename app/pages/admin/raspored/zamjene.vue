<script setup lang="ts">
/**
 * `/admin/raspored/zamjene` — every swap request, and the only screen that can
 * answer one.
 *
 * It was a tab on *Raspored* and is now its own page, reached from the amber
 * strip the week draws while something is pending. The owner asked for one view
 * on that screen and this is not part of the week — it is the exception the week
 * occasionally throws up. Nothing about the flow changed: a waiter raises the
 * request from `/konobar/raspored`, and *Dodijeli* / *Odbij* here are the two
 * admin-only routes that close it.
 */
definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Zamjene' })
</script>

<template>
  <div class="a-page">
    <UiPageHead eyebrow="Ljudi" title="Zamjene" sub="Zahtjevi za zamjenu smjene">
      <template #actions>
        <NuxtLink to="/admin/raspored" class="a-back">Raspored</NuxtLink>
      </template>
    </UiPageHead>

    <ClientOnly>
      <RasporedZamjene />
    </ClientOnly>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.a-page :deep(.a-table-wrap) { contain: paint; }

.a-back {
  display: inline-flex;
  align-items: center;
  min-height: var(--tap);
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-field);
  background: var(--surface);
  color: var(--ink);
  font-size: var(--text-label);
  font-weight: 600;
  text-decoration: none;
}
</style>
