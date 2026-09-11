<script setup lang="ts">
/**
 * Whether the dock exists on this screen — and nothing else.
 *
 * `app/layouts/admin.vue` mounts this once, so `ChatDockRoom` survives every
 * route change with its thread and its half-typed reply intact. The one route
 * it must not appear on is `/admin/razgovor`, which *is* the conversation at
 * full size: a copper button floating over it is noise, and two live
 * `useChat({ admin: true })` instances on one screen would read the same thread
 * twice on every tab focus.
 *
 * The guard is a `v-if` on the child rather than a `v-show` on its chrome
 * precisely so that only one of them is ever wired up. Nothing is lost in the
 * detour: the dock's own state lives in `useState` (which outlives the
 * component), the draft and the last room used live in IndexedDB, and the
 * thread lives in the Pinia store the page is filling meanwhile.
 */
const route = useRoute()

const onFullPage = computed(() => route.path.startsWith('/admin/razgovor'))
</script>

<template>
  <ChatDockRoom v-if="!onFullPage" />
</template>
