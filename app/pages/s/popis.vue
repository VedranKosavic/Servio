<script setup lang="ts">
/**
 * `/s/popis` — the same *Brzi popis*, reached from the bar.
 *
 * One component, two routes (PHASE3 §3): the šanker is the usual custodian and
 * opens and closes the shelf from `/s`, so his back arrow goes to the ticket
 * queue and not to a floor plan he does not use.
 */
useHead({ title: 'Brzi popis' })
</script>

<template>
  <PopisPage back-to="/s" />
</template>
