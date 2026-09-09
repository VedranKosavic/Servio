<script setup lang="ts">
/**
 * One file on *Izvoz*: what it is, what one row of it means, and *Preuzmi*.
 *
 * **The download is an anchor, not a button.** A CSV is saved by the browser
 * following the URL and reading `Content-Disposition: attachment` off the
 * response; a `$fetch` through `useAdminApi` would read the bytes into a
 * variable and the file would never reach the disk. An `<a>` also gives the
 * owner the two things a button cannot — open in a new tab, and copy the link
 * — so it is styled like the kit's primary button rather than replaced by one.
 */
import type { ExportSpec } from '#shared/types/export'

defineProps<{
  spec: ExportSpec
  /** Built by `exportUrl()`; no component writes a path of its own. */
  href: string
  /** *Popis* before a count is chosen: there is nothing to download yet. */
  disabled?: boolean
  /** The Bosnian sentence under the controls, when there is something to say. */
  hint?: string
}>()
</script>

<template>
  <UiCard :title="spec.title_bs">
    <p class="i-sub">{{ spec.sub_bs }}</p>

    <div v-if="$slots.default" class="i-controls">
      <slot />
    </div>

    <p v-if="hint" class="i-hint">{{ hint }}</p>

    <div class="i-foot">
      <code class="i-file">{{ spec.filename }}</code>
      <span v-if="disabled" class="i-dl off" aria-disabled="true">Preuzmi</span>
      <a v-else class="i-dl" :href="href">Preuzmi</a>
    </div>
  </UiCard>
</template>

<style scoped>
.i-sub { margin: 0; color: var(--ink-2); }
.i-hint { margin: 0; color: var(--muted); font-size: 13px; }
.i-controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }

.i-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: auto;
  padding-top: 4px;
}

.i-file {
  font-family: ui-monospace, "SFMono-Regular", "Menlo", monospace;
  font-size: 13px;
  color: var(--muted);
  flex-grow: 1;
  min-width: 0;
}

/* The kit's `primary` button, on an anchor. Same height, same radius, same ink. */
.i-dl {
  height: 36px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 14px;
  font-weight: 600;
  font-size: 14px;
  background: var(--accent);
  color: var(--on-accent);
  text-decoration: none;
  white-space: nowrap;
}

.i-dl.off { background: var(--surface-2); color: var(--muted); cursor: default; }

@media (max-width: 1023px) {
  .i-dl { height: 44px; font-size: 15px; padding: 0 18px; }
}
</style>
