<script setup lang="ts">
/**
 * *Dostupno do* — the hour after which a menu article cannot be ordered
 * ("Happy Hour kafa do 9:00", the owner 17.09.2026). Empty is all day.
 * A native time field: it commits on change, and clearing it sends `null`.
 */
const props = defineProps<{ modelValue: string | null, label: string, disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()

function onChange(event: Event) {
  const value = (event.target as HTMLInputElement).value
  const next = /^\d{2}:\d{2}$/.test(value) ? value : null
  if (next !== props.modelValue) emit('update:modelValue', next)
}
</script>

<template>
  <span class="dd">
    <input
      class="dd-input num"
      type="time"
      :value="modelValue ?? ''"
      :aria-label="label"
      :disabled="disabled"
      @change="onChange"
    >
    <button
      v-if="modelValue"
      type="button"
      class="dd-clear"
      :aria-label="`${label} — cijeli dan`"
      :disabled="disabled"
      @click="emit('update:modelValue', null)"
    >×</button>
  </span>
</template>

<style scoped>
.dd { display: inline-flex; align-items: center; gap: 4px; }
.dd-input {
  height: 36px; padding: 0 8px;
  border: 1px solid var(--line); border-radius: var(--radius-field);
  background: var(--surface); color: var(--ink); font: inherit; font-size: var(--text-label);
}
.dd-clear {
  width: 28px; height: 28px; border: 0; border-radius: var(--radius-field);
  background: transparent; color: var(--muted); font-size: 18px; cursor: pointer;
}
.dd-clear:hover { background: var(--surface-2); color: var(--ink); }
</style>
