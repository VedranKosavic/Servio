<script setup lang="ts">
/**
 * `/konobar/raspored` — S17 from the waiter's side.
 *
 * The screen itself is `RasporedStaffPage`; this file exists so the week has a
 * route inside `/konobar` whose back arrow lands on the floor plan.
 */
useHead({ title: 'Raspored' })
</script>

<template>
  <RasporedStaffPage back-to="/konobar" />
</template>
