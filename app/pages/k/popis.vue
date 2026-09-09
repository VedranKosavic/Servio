<script setup lang="ts">
/**
 * `/k/popis` — *Brzi popis* from the waiter's side.
 *
 * The screen itself is `PopisPage`; this file exists so the count has a route
 * inside `/k` whose back arrow lands on the floor plan. A waiter counts on the
 * nights there is no šanker (PLAN §15 Q2), and the first person in is the
 * custodian — so the same screen has to be reachable from both apps, with each
 * one's own way back.
 */
useHead({ title: 'Brzi popis' })
</script>

<template>
  <PopisPage back-to="/k" />
</template>
