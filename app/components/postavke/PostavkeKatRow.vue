<script setup lang="ts">
/**
 * One category on *Kategorije*, the way a phone draws it.
 *
 * The laptop gets a seven-column table. On a 390 px screen five of those columns
 * are a sideways drag — and four of them are facts the owner reads rather than
 * numbers he compares, which is the only thing a table is better at. So below
 * 1024 px the row stops being a table row and becomes **a name, one quiet line
 * that says what the category is, and a way in.**
 *
 * **The line is a sentence, not columns.** *Vrsta* is the grouping the monthly
 * spend-against-sales report is built on, so it stays on the row; the product
 * count and the number of quick notes ride with it, separated by middots, and
 * an off category carries the word *ugašena* beside its name rather than a
 * column of its own. Everything that is set once — the name, the kind, the
 * notes, the switch — is behind the chevron, in `PostavkeCategorySheet`.
 *
 * **Reordering is a mode, not a control on every row.** Two arrows sitting
 * permanently beside each name are two 44 px targets a thumb can hit while
 * scrolling, and a mis-hit silently reorders the waiter's menu. In the list's
 * *Redoslijed* mode the row drops its way in and shows its place in the menu
 * with the two arrows instead, so the only thing a tap can do is the thing the
 * mode is for.
 */
import type { CategoryAdmin } from '#shared/types'

const props = defineProps<{
  category: CategoryAdmin
  /** *Piće* / *Hrana* / *Nargila* / *Ostalo* — the page owns the map. */
  kindLabel: string
  /** Its 1-based place in the menu, shown while the list is being reordered. */
  position: number
  /** The list is in *Redoslijed* mode. */
  reorder: boolean
  /** Nothing above it / nothing below it, so one arrow has nowhere to go. */
  first: boolean
  last: boolean
  /** A move is in flight somewhere in the list; every arrow waits for it. */
  busy: boolean
}>()

const emit = defineEmits<{
  /** Open the sheet with this category's settings. */
  open: []
  /** Swap places with the neighbour above (−1) or below (+1). */
  move: [delta: -1 | 1]
}>()

/**
 * Bosnian counts in three shapes — 1 artikal, 2 artikla, 5 artikala — and the
 * rule is the last digit, except in the teens where everything is the third
 * shape. Written out here rather than guessed with a ternary, because "21
 * artikala" is the kind of thing that makes an app read as translated.
 */
function plural(n: number, one: string, few: string, many: string): string {
  const last = n % 10
  const teens = n % 100
  if (last === 1 && teens !== 11) return `${n} ${one}`
  if (last >= 2 && last <= 4 && (teens < 12 || teens > 14)) return `${n} ${few}`
  return `${n} ${many}`
}

/** *Piće · 7 artikala · 4 napomene* — only the parts that carry something. */
const meta = computed(() => {
  const parts = [
    props.kindLabel,
    plural(props.category.product_count, 'artikal', 'artikla', 'artikala'),
  ]
  const chips = props.category.note_chips.length
  if (chips > 0) parts.push(plural(chips, 'napomena', 'napomene', 'napomena'))
  return parts.join(' · ')
})
</script>

<template>
  <div class="p-row" :class="{ inactive: !category.active }">
    <!-- ---- Redoslijed --------------------------------------------------- -->
    <template v-if="reorder">
      <span class="p-pos num">{{ position }}.</span>
      <span class="p-text p-text-move"><span class="p-name">{{ category.name }}</span></span>

      <button
        type="button"
        class="p-arrow"
        :disabled="first || busy"
        :aria-label="`Pomjeri gore, ${category.name}`"
        @click="emit('move', -1)"
      >
        <!-- The kit's chevron points right; these are the same 24 px grid and
             1.8 stroke, turned up and down. -->
        <svg
          width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        ><path d="M6 15l6-6 6 6" /></svg>
      </button>

      <button
        type="button"
        class="p-arrow"
        :disabled="last || busy"
        :aria-label="`Pomjeri dole, ${category.name}`"
        @click="emit('move', 1)"
      >
        <svg
          width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        ><path d="M6 9l6 6 6-6" /></svg>
      </button>
    </template>

    <!-- ---- the list as it stands most of the year ----------------------- -->
    <button
      v-else
      type="button"
      class="p-main"
      :aria-label="`Uredi kategoriju, ${category.name}`"
      @click="emit('open')"
    >
      <span class="p-text">
        <span class="p-name">
          {{ category.name }}
          <UiPill v-if="!category.active" tone="bad">ugašena</UiPill>
        </span>
        <span class="p-meta">{{ meta }}</span>
      </span>
      <UiIcon name="chevron-right" :size="20" class="p-chev" />
    </button>
  </div>
</template>

<style scoped>
.p-row {
  display: flex;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid var(--line-soft);
  min-width: 0;
}

.p-row:last-child { border-bottom: 0; }

/* Off the menu: still readable, just quieter — and the *ugašena* pill says it
   in a word as well, so the state is never only an opacity. */
.p-row.inactive .p-text { opacity: 0.6; }

/* The whole row is the way in, so the target is the row and not a 20 px
   chevron at the end of it. */
.p-main {
  flex-grow: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: var(--tap);
  padding: 10px 10px 10px 16px;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  color: var(--ink);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}

.p-main:hover { background: var(--surface-2); }
.p-main:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

.p-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex-grow: 1; }

.p-name {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--ink);
  line-height: 1.3;
}

.p-meta { font-size: var(--text-micro); color: var(--muted); }

.p-chev { flex-shrink: 0; color: var(--muted); }

/* ---- Redoslijed --------------------------------------------------------- */

.p-pos {
  flex-shrink: 0;
  width: 26px;
  padding-left: 12px;
  font-size: var(--text-micro);
  color: var(--muted);
  font-weight: 600;
}

.p-text-move { padding: 12px 0; }

.p-arrow {
  flex-shrink: 0;
  width: var(--tap);
  height: var(--tap);
  border: 0;
  background: transparent;
  color: var(--ink-2);
  border-radius: var(--radius-field);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}

.p-arrow:last-child { margin-right: 6px; }
.p-arrow:hover:not(:disabled) { background: var(--surface-2); color: var(--ink); }
.p-arrow:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.p-arrow:disabled { color: var(--line); cursor: default; }
</style>
