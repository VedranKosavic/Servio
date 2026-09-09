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
  border-radius: 10px;
  padding: 3px;
}

.a-seg-item {
  height: 30px;
  padding: 0 12px;
  border-radius: 8px;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-2);
  cursor: pointer;
}

.a-seg-item.on { background: var(--surface); color: var(--ink); }

@media (max-width: 1023px) {
  .a-seg-item { height: 38px; font-size: 15px; padding: 0 16px; }
}
</style>
