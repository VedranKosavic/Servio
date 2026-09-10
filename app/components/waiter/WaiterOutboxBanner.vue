<script setup lang="ts">
/**
 * The strip under the header, and only once something has been waiting five
 * minutes.
 *
 * Below that it says nothing: a queue that is thirty seconds old is normal and
 * a banner about it would train everybody to ignore banners. Past five minutes
 * it is worth a look at the phone's own wifi, and the sentence says exactly
 * that instead of blaming anybody.
 */
const { banner } = useSync()
</script>

<template>
  <p
    v-if="banner"
    class="-mx-4 flex items-start gap-2 border-b border-line bg-warn-soft px-4 py-2.5 text-label text-warn"
    role="status"
  >
    <svg
      width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
      class="mt-0.5 shrink-0" aria-hidden="true"
    >
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
    </svg>
    <span>{{ banner }}</span>
  </p>
</template>
