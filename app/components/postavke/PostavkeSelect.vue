<script setup lang="ts">
/**
 * A `<select>` for a table cell or a repeated line — the zone of a table, the
 * shelf item on a *normativ* line.
 *
 * `UiField` is the right control for a form, where every input has its own
 * visible label. In a table the column header is the label already, and a
 * repeated line has one caption above the whole column, so this carries its
 * accessible name in `label` and draws nothing.
 */
defineProps<{
  modelValue: string
  options: Array<{ value: string, label: string }>
  /** The accessible name — never drawn. */
  label: string
  disabled?: boolean
  width?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <select
    class="p-select"
    :style="width ? { width } : undefined"
    :value="modelValue"
    :aria-label="label"
    :disabled="disabled"
    @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
  >
    <option v-for="option in options" :key="option.value" :value="option.value">
      {{ option.label }}
    </option>
  </select>
</template>

<style scoped>
.p-select {
  height: 34px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--field-bg);
  padding: 0 8px;
  font: inherit;
  font-size: var(--text-label);
  color: var(--ink);
  max-width: 100%;
}

.p-select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.p-select:disabled { opacity: 0.5; }

@media (max-width: 1023px) {
  .p-select { height: 44px; font-size: var(--text-section); }
}
</style>
