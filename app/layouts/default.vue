<script setup lang="ts">
/**
 * The base layout: the dark page, a full-height column, and a safe-area inset
 * so nothing sits under an iPhone's home indicator or notch.
 *
 * Deliberately empty of chrome. The waiter screens and the bartender screens
 * bring their own headers; this only guarantees the background, the width and
 * the padding they sit in.
 */
</script>

<template>
  <div class="min-h-dvh bg-bg text-text">
    <div class="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <slot />
    </div>
  </div>
</template>
