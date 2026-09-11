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
 *
 * **Nazad appears by itself.** Every drill-down used to be a one-way trip: the
 * phone has four bottom tabs and no browser chrome, so the only way out of a
 * shift or an article was to tap a tab, which threw away where you had been.
 * The head now draws the way back on any screen that is not itself a tab
 * destination, and no page has to remember to ask for it.
 *
 * It is a `NuxtLink` to a real parent and **not** `router.back()`. History is
 * not a hierarchy: after a reload there is nothing behind you, and after
 * arriving from a link *back* is whatever the person was reading before the
 * app. A named destination always goes to the same place, which is the thing
 * that makes it worth tapping. `adminBack` in `app/utils/adminNav.ts` picks it
 * by climbing the router, so it can never point at a URL that is not a page.
 */
const props = defineProps<{
  title: string
  /** The quiet line under the title: a date, a period, "Ažurirano 22:41". */
  sub?: string
  /** The small caps line above it: "Lokal", "Roba", "Meni i postavke". */
  eyebrow?: string
  /** Shown in `--danger` under the head when a read did not land. */
  stale?: string
  /**
   * Override the computed way back: a path, or `null` on a screen that must not
   * offer one. Left alone (`undefined`), the head works it out.
   *
   * **`null` and not `false`, and that is not a style choice.** Vue reads the
   * prop *types* off this interface, and a union containing `false` makes this a
   * Boolean prop — at which point an absent `back` arrives as `false` rather
   * than `undefined`, because that is how Vue casts a boolean attribute nobody
   * wrote. The first version of this said `string | false`, so the "suppress
   * it" branch fired on every screen in the app and the back link never drew
   * once. `null` is not a boolean, so nothing is cast and an absent prop stays
   * absent.
   */
  back?: string | null
}>()

const route = useRoute()
const router = useRouter()

const backTo = computed(() => {
  if (props.back === null) return null
  if (typeof props.back === 'string') return props.back
  return adminBack(route.path, candidate => router.resolve(candidate).matched.length > 0)
})

const backLabel = computed(() => (backTo.value ? adminBackLabel(backTo.value) : ''))
const backAria = computed(() => (backTo.value ? adminBackAria(backTo.value) : ''))
</script>

<template>
  <header class="a-head">
    <NuxtLink v-if="backTo" :to="backTo" class="a-head-back" :aria-label="backAria">
      <!-- The kit has one chevron and it points right; a back arrow is the same
           shape mirrored, which keeps the two identical in weight and grid. -->
      <UiIcon name="chevron-right" :size="20" class="a-head-back-icon" />
      <span>{{ backLabel }}</span>
    </NuxtLink>

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

/**
 * The way back sits above the title on its own line, at full row width.
 *
 * Not beside the title: a phone title wraps to two lines often enough that a
 * left-hand button would either squeeze it or float away from it. Above reads
 * as "you came from here", which is what it means, and it gives the tap a
 * 44 px row of its own without stealing any width from the title.
 */
.a-head-back {
  order: -1;
  flex-basis: 100%;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  align-self: flex-start;
  height: var(--tap);
  margin: -10px 0 -6px -8px;
  padding: 0 10px 0 4px;
  border-radius: var(--radius-field);
  color: var(--muted);
  font-size: var(--text-label);
  font-weight: 600;
  text-decoration: none;
  width: fit-content;
  transition: color var(--dur-fast) var(--ease-standard);
}

.a-head-back:hover { color: var(--ink); }
.a-head-back:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.a-head-back-icon { transform: scaleX(-1); }

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
