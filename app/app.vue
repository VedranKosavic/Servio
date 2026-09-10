<script setup lang="ts">
// One title rule for the whole app. The wordmark comes from `app/utils/brand.ts`
// so a rename is one constant, not a grep across every `useHead`.
useHead({ titleTemplate: (t?: string) => (t ? `${t} · ${APP_NAME}` : APP_NAME) })
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
