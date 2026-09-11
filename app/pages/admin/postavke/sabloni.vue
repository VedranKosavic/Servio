<script setup lang="ts">
/**
 * `/admin/postavke/sabloni` — *Šabloni*, the two or three shifts a week is built
 * out of.
 *
 * It briefly redirected to a tab on *Raspored*; the owner then asked for that
 * screen to be the week and nothing else, so the page is back where its URL
 * always pointed. It is deliberately **not** a chip in the *Meni i postavke*
 * strip: templates are set once and then left alone for a year, and the one
 * moment anybody needs this screen is when *Raspored* has no rows to draw — so
 * the week's own empty state is what links here, which is the only signpost that
 * ever arrives at the right time.
 *
 * The body is `app/components/raspored/RasporedSabloni.vue`, which is where it
 * has lived since the move and where the rules about editing a template are
 * written down.
 */
definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Šabloni' })
</script>

<template>
  <div class="a-page">
    <UiPageHead
      eyebrow="Raspored"
      title="Šabloni"
      sub="Smjene od kojih se gradi sedmica"
    />

    <ClientOnly>
      <RasporedSabloni />
    </ClientOnly>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.a-page :deep(.a-table-wrap) { contain: paint; }
</style>
