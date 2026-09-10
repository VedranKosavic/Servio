<script setup lang="ts">
/**
 * `/k/razgovor` — **S15 *Kanali***, from the waiter's side.
 *
 * The screen is `ChatChannelsPage`; this file exists so the list has a route
 * inside `/k` whose back arrow lands on the floor plan (the `/s/popis`
 * precedent).
 */
useHead({ title: 'Razgovor' })
</script>

<template>
  <ChatChannelsPage back-to="/k" base="/k/razgovor" />
</template>
