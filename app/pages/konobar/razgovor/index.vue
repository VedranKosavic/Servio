<script setup lang="ts">
/**
 * `/konobar/razgovor` — **S15 *Kanali***, from the waiter's side.
 *
 * The screen is `ChatChannelsPage`; this file exists so the list has a route
 * inside `/konobar` whose back arrow lands on the floor plan (the `/sanker/popis`
 * precedent).
 */
useHead({ title: 'Razgovor' })
</script>

<template>
  <ChatChannelsPage back-to="/konobar" base="/konobar/razgovor" />
</template>
