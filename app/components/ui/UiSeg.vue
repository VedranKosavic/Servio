<script setup lang="ts">
/**
 * The segmented control — *Važno / Sve*, *Unutra / Bašta*.
 *
 * `v-model` on the option's value. Two or three options; more than that is a
 * select, not a segment.
 */
const props = defineProps<{
  modelValue: string
  options: Array<{ value: string, label: string }>
  /** Read out by a screen reader in place of "group". */
  label?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

function pick(value: string) {
  if (value !== props.modelValue) emit('update:modelValue', value)
}
</script>

<template>
  <div class="a-seg" role="group" :aria-label="label">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="a-seg-item"
      :class="{ on: option.value === modelValue }"
      :aria-pressed="option.value === modelValue"
      @click="pick(option.value)"
    >{{ option.label }}</button>
  </div>
</template>

<style scoped>
.a-seg {
  display: inline-flex;
  gap: 2px;
  background: var(--surface-2);
  border-radius: var(--radius-field);
  padding: 3px;
}

.a-seg-item {
  height: 32px;
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

/* The chosen one is lifted out of the well onto the card's own material, which
   is the same "a step up the ladder" depth every other state change uses. */
.a-seg-item.on {
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-card);
}

@media (max-width: 1023px) {
  .a-seg-item { height: 40px; font-size: var(--text-body); padding: 0 16px; }
}
</style>
