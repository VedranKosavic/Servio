<script setup lang="ts">
/**
 * The icon set, inline.
 *
 * Every path here is copied verbatim from `design/KIT.md` §"Icon set": a 24 px
 * grid, `stroke="currentColor"`, `stroke-width="1.8"`, no fill. Inline SVG and
 * not an icon font or a package, for three reasons — an icon inherits the text
 * colour it sits in (so the copper nav item and the grey one need no variants),
 * nothing is downloaded before the first paint, and there is no emoji anywhere
 * in this app.
 */
export type IconName =
  | 'pulse' | 'money' | 'box' | 'list' | 'users' | 'calendar'
  | 'chevron-right' | 'check' | 'x' | 'clock' | 'more'
  // Phase 4. `chat` is *Razgovor*, `image` is a photo in a thread; `calendar`
  // already covers *Raspored*. Same 24 px grid, same stroke, still no emoji.
  | 'chat' | 'image'

withDefaults(defineProps<{
  name: IconName
  /** 20 inside a chip, 24 everywhere else. */
  size?: number
}>(), { size: 24 })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-if="name === 'pulse'" d="M3 12h4l3-7 4 14 3-7h4" />

    <template v-else-if="name === 'money'">
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <circle cx="12" cy="12" r="3" />
    </template>

    <template v-else-if="name === 'box'">
      <path d="M3 8l9-4 9 4-9 4z" />
      <path d="M3 8v9l9 4 9-4V8" />
      <path d="M12 12v9" />
    </template>

    <path v-else-if="name === 'list'" d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />

    <template v-else-if="name === 'users'">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15.5 14.5A5 5 0 0 1 21 20" />
    </template>

    <template v-else-if="name === 'calendar'">
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </template>

    <path v-else-if="name === 'chevron-right'" d="M9 6l6 6-6 6" />
    <path v-else-if="name === 'check'" d="M5 12l5 5L20 7" />
    <path v-else-if="name === 'x'" d="M6 6l12 12M18 6L6 18" />

    <template v-else-if="name === 'clock'">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </template>

    <path
      v-else-if="name === 'chat'"
      d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4z"
    />

    <template v-else-if="name === 'image'">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M21 16l-5-5-6 6-2-2-5 5" />
    </template>

    <template v-else-if="name === 'more'">
      <circle cx="6" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="18" cy="12" r="1.5" />
    </template>
  </svg>
</template>
