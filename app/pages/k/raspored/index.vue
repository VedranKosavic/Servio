<script setup lang="ts">
/**
 * `/k/raspored` — S17 from the waiter's side.
 *
 * The screen itself is `RasporedStaffPage`; this file exists so the week has a
 * route inside `/k` whose back arrow lands on the floor plan.
 */
useHead({ title: 'Raspored' })
</script>

<template>
  <RasporedStaffPage back-to="/k" />
</template>
