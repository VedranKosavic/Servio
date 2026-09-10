<script setup lang="ts">
/**
 * The head of every `/admin` page: the title, the line under it, and the page's
 * own buttons.
 *
 * It exists because fifteen files had grown their own copy of the same twenty
 * lines of CSS — `font-size: 28px` written out by hand fifteen times, drifting
 * by a pixel and a letter-spacing at a time. A page title is a step on the type
 * scale (`--text-title`, in the display face), not a number a page picks, and
 * now there is one place that decides it.
 *
 * **Three steps, on purpose.** An `eyebrow` (12 px letterspaced caps) says which
 * part of the app this is, the title says which screen, and `sub` says the state
 * of it — the date, the period, when it last refreshed. That is the hierarchy the
 * rest of the page then inherits: section headings are one step down from the
 * title, row text one step down from those.
 *
 * `stale` is the sentence a page shows when its numbers are older than it would
 * like. It is a `role="status"` and not an `alert`, because the screen still
 * works: the old figures are on it and it is saying so.
 */
defineProps<{
  title: string
  /** The quiet line under the title: a date, a period, "Ažurirano 22:41". */
  sub?: string
  /** The small caps line above it: "Lokal", "Roba", "Meni i postavke". */
  eyebrow?: string
  /** Shown in `--danger` under the head when a read did not land. */
  stale?: string
}>()
</script>

<template>
  <header class="a-head">
    <div class="a-head-text">
      <p v-if="eyebrow || $slots.eyebrow" class="a-head-eyebrow">
        <slot name="eyebrow">{{ eyebrow }}</slot>
      </p>
      <h1 class="a-head-title">{{ title }}</h1>
      <p v-if="sub || $slots.sub" class="a-head-sub"><slot name="sub">{{ sub }}</slot></p>
      <p v-if="stale" class="a-head-stale" role="status">{{ stale }}</p>
    </div>

    <div v-if="$slots.actions" class="a-head-actions"><slot name="actions" /></div>
  </header>
</template>

<style scoped>
.a-head {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
  min-width: 0;
}

.a-head-text { display: flex; flex-direction: column; min-width: 0; }

/* The eyebrow is also where a drill-down's way back lives: "Nazad na smjenu"
   above the title reads as where-you-are, which is what a back link is. */
.a-head-eyebrow {
  margin: 0 0 6px;
  font-size: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent-text);
}

.a-head-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-title);
  line-height: 1.14;
  letter-spacing: -0.022em;
  font-weight: 700;
}

.a-head-sub {
  margin: 5px 0 0;
  color: var(--muted);
  font-size: var(--text-micro);
  font-variant-numeric: tabular-nums;
}

.a-head-eyebrow :deep(a) {
  color: inherit;
  text-decoration: none;
  border-bottom: 1px solid transparent;
}

.a-head-eyebrow :deep(a:hover) { border-bottom-color: currentcolor; }

.a-head-stale {
  margin: 6px 0 0;
  color: var(--danger);
  font-size: var(--text-micro);
  font-weight: 500;
}

.a-head-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

@media (max-width: 1023px) {
  .a-head { align-items: flex-start; }
  /* Left-aligned and its own width, not stretched: a page's secondary action
     blown up to the full width of a phone reads as the thing the page is for,
     and it never is — that is what a primary button in an action bar is for. */
  .a-head-actions { margin-left: 0; width: 100%; }
}
</style>
