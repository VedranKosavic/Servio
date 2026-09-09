<script setup lang="ts">
useHead({ titleTemplate: (t?: string) => (t ? `${t} · Šank` : 'Šank') })
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
