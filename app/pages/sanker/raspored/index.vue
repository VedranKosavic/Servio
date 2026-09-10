<script setup lang="ts">
/**
 * `/sanker/raspored` — the same S17, reached from the bar.
 *
 * One component, two routes (PHASE3 §3): the šanker's back arrow returns to the
 * ticket queue and not to a floor plan he does not use.
 */
useHead({ title: 'Raspored' })
</script>

<template>
  <RasporedStaffPage back-to="/sanker" />
</template>
