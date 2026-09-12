<script setup lang="ts">
/**
 * The segmented control — *Važno / Sve*, *Unutra / Bašta*, *Ova sedmica /
 * Sljedeća*. One control, both themes.
 *
 * It exists because two full-width buttons side by side are not a control —
 * they are two buttons, and on the floor plan the copper one competed with the
 * tables it sits above. A segment is *material*, never copper: the accent is
 * reserved for the primary action and for the person's own state (DESIGN §2),
 * and "which half of the room am I looking at" is neither.
 *
 * `v-model` on the option's value. Two or three options; more than that is a
 * select, not a segment.
 *
 * **Two shapes, one component.** The default is an inline pill that takes the
 * width of its labels — a filter sitting in a toolbar, and see `width:
 * max-content` below for why that needs saying twice. `block` is the
 * full-width form the floor plan needs: equal columns and a thumb that *slides*
 * rather than a background that jumps, so the control reads as one object with
 * a moving part. The thumb moves through `--dur-fast`, which means reduced
 * motion switches it off for free.
 *
 * The segments stay plain buttons with `aria-pressed` rather than
 * `role="tab"`: nothing here controls a tabpanel, and a screen reader (like a
 * Playwright locator) should still find *Bašta* as a button.
 *
 * Height comes from `--tap` — 48 px on the waiter and bartender screens, 44 on
 * the dashboard — so the one implementation is correct in both areas.
 */
const props = withDefaults(defineProps<{
  modelValue: string
  /**
   * `hint` is a quiet second word inside the segment — a count, usually, as in
   * *Unutra 10* / *Bašta 3*. It is there so a filter can carry the size of what
   * it filters instead of being a pair of words the person has to try.
   */
  options: ReadonlyArray<{ value: string, label: string, hint?: string }>
  /** Read out by a screen reader in place of "group". */
  label?: string
  /** Full width, equal columns, sliding thumb. The floor plan's shape. */
  block?: boolean
}>(), { label: undefined, block: false })

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const index = computed(() =>
  Math.max(0, props.options.findIndex(o => o.value === props.modelValue)))
const count = computed(() => props.options.length)

function pick(value: string) {
  if (value !== props.modelValue) emit('update:modelValue', value)
}
</script>

<template>
  <div
    class="a-seg"
    :class="{ block }"
    role="group"
    :aria-label="label"
    :style="block ? { '--seg-count': count, '--seg-index': index } : undefined"
  >
    <span v-if="block" class="a-seg-thumb" aria-hidden="true" />
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="a-seg-item"
      :class="{ on: option.value === modelValue }"
      :aria-pressed="option.value === modelValue"
      @click="pick(option.value)"
    >{{ option.label }}<span v-if="option.hint" class="a-seg-hint num">{{ option.hint }}</span></button>
  </div>
</template>

<style scoped>
/**
 * **`width: max-content` is load-bearing.** The track is `inline-flex`, which
 * says "as wide as the labels" — and then loses that argument to every column
 * it is dropped into: a flex column stretches its children across the cross
 * axis, so on the floor plan the control ran the full width of the card with
 * two labels at one end and a hand's width of empty grey at the other. It read
 * as a broken toolbar rather than a switch. Width beats `align-items: stretch`,
 * and unlike `align-self` it means nothing in a row, so the segments that sit
 * in a card head are untouched.
 */
.a-seg {
  display: inline-flex;
  width: max-content;
  max-width: 100%;
  gap: 2px;
  background: var(--surface-2);
  border-radius: var(--radius-field);
  padding: 3px;
}

.a-seg-item {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: calc(var(--tap) - 12px);
  padding: 0 14px;
  border-radius: 7px;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: var(--text-label);
  font-weight: 600;
  color: var(--ink-2);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}

.a-seg-item:hover { color: var(--ink); }

/* The count, a step quieter than the word it belongs to. Tabular, because it
   changes while somebody is looking at it. */
.a-seg-hint {
  font-size: var(--text-caption);
  font-weight: 600;
  color: var(--muted);
}

.a-seg-item.on .a-seg-hint { color: var(--ink-2); }

/* The chosen one is lifted out of the well onto the card's own material, which
   is the same "a step up the ladder" depth every other state change uses. */
.a-seg-item.on {
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-card);
}

@media (max-width: 1023px) {
  .a-seg-item { height: var(--tap); font-size: var(--text-body); padding: 0 16px; }
}

/* ---- the block shape: a real track with a moving part ------------------- */

.a-seg.block {
  width: auto;
  position: relative;
  display: grid;
  grid-template-columns: repeat(var(--seg-count), 1fr);
  gap: 0;
  padding: 4px;
  border-radius: var(--radius-chip);
  background: var(--bg-2);
  border: 1px solid var(--line);
}

/* `width` is a share of the track minus its own padding and `translateX` is a
   multiple of that width, so the thumb lands on the segment however many
   there are. */
.a-seg-thumb {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 4px;
  width: calc((100% - 8px) / var(--seg-count));
  transform: translateX(calc(var(--seg-index) * 100%));
  border-radius: var(--radius-chip);
  background: var(--surface-3);
  border: 1px solid var(--line);
  transition: transform var(--dur-fast) var(--ease-out-soft);
}

/* `nowrap`: a label that wraps opens the track to two lines while its
   neighbours stay on one, and the segments then sit on three different
   baselines beside a thumb that is taller than the text in it. A segment's
   label is one or two words — if it does not fit, the label is wrong, not the
   control. */
.a-seg.block .a-seg-item {
  position: relative;
  z-index: 1;
  height: auto;
  min-height: var(--tap);
  padding: 0 12px;
  white-space: nowrap;
  border-radius: var(--radius-chip);
  background: transparent;
  box-shadow: none;
  color: var(--muted);
  font-size: var(--text-body);
  transition: color var(--dur-fast) var(--ease-standard);
}

.a-seg.block .a-seg-item.on { color: var(--ink); }
</style>
