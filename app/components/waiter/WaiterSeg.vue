<script setup lang="ts">
/**
 * A segmented control: one track, one thumb, two or three choices.
 *
 * It exists because two full-width buttons side by side are not a control —
 * they are two buttons, and on the floor plan the copper one competed with the
 * tables it sits above. A segment is *material*, never copper: the accent is
 * reserved for the primary action and for the person's own state (DESIGN §2),
 * and "which half of the room am I looking at" is neither.
 *
 * The thumb is a real element that slides, rather than a background that jumps,
 * so the control reads as one object with a moving part. It moves through
 * `--dur-fast`, which means reduced motion switches it off for free.
 *
 * The segments stay plain buttons with `aria-pressed` rather than
 * `role="tab"`: nothing here controls a tabpanel, and a screen reader (like a
 * Playwright locator) should still find *Bašta* as a button.
 *
 * Built here rather than in `main.css` because it is the first screen that
 * needed one; it is a candidate for consolidation into the system next to
 * `/admin`'s `UiSeg`.
 */
const props = defineProps<{
  options: readonly { id: string, label: string }[]
  modelValue: string
  /** A11y name for the group, e.g. "Zona". */
  label: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const index = computed(() => Math.max(0, props.options.findIndex(o => o.id === props.modelValue)))
const count = computed(() => props.options.length)
</script>

<template>
  <div
    class="seg"
    role="group"
    :aria-label="label"
    :style="{ '--seg-count': count, '--seg-index': index }"
  >
    <span class="seg-thumb" aria-hidden="true" />
    <button
      v-for="option in options"
      :key="option.id"
      type="button"
      class="seg-item"
      :class="{ on: option.id === modelValue }"
      :aria-pressed="option.id === modelValue"
      @click="emit('update:modelValue', option.id)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.seg {
  position: relative;
  display: grid;
  grid-template-columns: repeat(var(--seg-count), 1fr);
  gap: 0;
  padding: 4px;
  border-radius: var(--radius-chip);
  background: var(--bg-2);
  border: 1px solid var(--line);
}

/* The moving part. `left` is a percentage of the track minus its own padding,
   so it lands on the segment however many there are. */
.seg-thumb {
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

.seg-item {
  position: relative;
  z-index: 1;
  min-height: 48px;
  padding: 0 12px;
  border-radius: var(--radius-chip);
  background: transparent;
  border: 0;
  color: var(--muted);
  font-size: var(--text-body);
  font-weight: 600;
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-standard);
}

.seg-item.on {
  color: var(--ink);
}
</style>
