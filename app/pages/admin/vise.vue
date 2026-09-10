<script setup lang="ts">
/**
 * *Više* — the phone's fourth tab.
 *
 * The bottom bar holds four targets, and the dashboard has six pages; the three
 * that do not fit live here as a plain card list. On a laptop nobody arrives
 * here, because the left nav shows all six.
 */
definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Više' })

const changes = useAdminChanges()

// The list comes from `app/utils/adminNav.ts` (WP0), the same array the left
// nav reads — so a Phase 4 row lands in both places at once.
const links = adminMore()
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
          <UiPill v-if="link.id === 'dnevnik' && changes.logUnread.value" tone="bad">novo</UiPill>
          <UiIcon name="chevron-right" :size="20" />
        </NuxtLink>
      </template>
    </UiCard>

    <!-- The phone has no left nav, so the cross-links to the staff app live
         here — the owner also serves tables, and both screens ask for a session
         rather than for a role. He has no `mode` of his own (his landing is the
         dashboard), so he picks a screen by opening it. -->
    <UiCard>
      <NuxtLink to="/konobar" class="a-more-row">
        <span class="a-more-text">
          <strong>Konobarski ekran</strong>
          <small>Stolovi, narudžbe i naplata</small>
        </span>
        <UiIcon name="chevron-right" :size="20" />
      </NuxtLink>
      <NuxtLink to="/sanker" class="a-more-row">
        <span class="a-more-text">
          <strong>Šankerski ekran</strong>
          <small>Priprema, šank i zaliha</small>
        </span>
        <UiIcon name="chevron-right" :size="20" />
      </NuxtLink>
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
</style>
