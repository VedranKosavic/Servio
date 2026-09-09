<script setup lang="ts">
/**
 * *Puls* — the live page.
 *
 * WP0 ships the shell around it; the page itself (six tiles, *Zahtijeva
 * pažnju*, the feed and the table grid, all off one `GET /api/owner/live`) is
 * WP1 and replaces this file entirely.
 */
definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Puls' })
</script>

<template>
  <div class="a-page">
    <header class="a-page-head">
      <h1>Puls</h1>
      <p class="a-page-sub">Šta se upravo dešava u lokalu</p>
    </header>

    <UiCard title="Puls dolazi u WP1">
      <p class="a-muted">
        Ljuska je gotova: navigacija, tema i prijava rade. Kartice, lista
        <em>Zahtijeva pažnju</em>, zadnje stavke i mreža stolova stižu sa
        sljedećim paketom.
      </p>
    </UiCard>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 18px; min-width: 0; }

.a-page-head { display: flex; flex-direction: column; gap: 2px; }

.a-page-head h1 {
  font-family: var(--font-title);
  font-weight: 700;
  font-size: 28px;
  letter-spacing: -0.015em;
  margin: 0;
  line-height: 1.1;
}

.a-page-sub { margin: 0; color: var(--muted); font-size: 14px; }
.a-muted { margin: 0; color: var(--ink-2); }
</style>
