<script setup lang="ts">
/**
 * `/s/razgovor` — the same channel list, reached from the bar.
 *
 * One component, two routes (PHASE3 §3): the šanker's back arrow goes to the
 * ticket queue, not to a floor plan he does not use.
 */
useHead({ title: 'Razgovor' })
</script>

<template>
  <ChatChannelsPage back-to="/s" base="/s/razgovor" />
</template>
