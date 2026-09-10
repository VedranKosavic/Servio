<script setup lang="ts">
/**
 * `PostavkeNum` with a visible label and a hint line — the form version.
 *
 * Same reason it is not `UiField`: the kit's numeric field reformats the value
 * on every keystroke, which fights anybody typing a number longer than one
 * digit. The `<label>` wraps the input, so clicking the caption puts the caret
 * in the box without an id to match up.
 */
defineProps<{
  label: string
  modelValue: number | null
  kind?: 'money' | 'decimal' | 'int'
  suffix?: string
  hint?: string
  error?: string | null
  placeholder?: string
  disabled?: boolean
  pending?: boolean
}>()

const emit = defineEmits<{
  /** On blur — the write. */
  commit: [value: number | null]
  /** Every keystroke, parsed — for a form whose primary button depends on it. */
  input: [value: number | null]
}>()
</script>

<template>
  <label class="p-nf">
    <span class="p-nf-label">
      {{ label }}
      <!-- The pill keeps its own casing; the caption's uppercase would make a
           quiet "sačuvano" shout. -->
      <span class="p-nf-badge"><slot name="badge" /></span>
    </span>
    <PostavkeNum
      :model-value="modelValue"
      :kind="kind"
      :label="label"
      :suffix="suffix"
      :placeholder="placeholder"
      :disabled="disabled"
      :pending="pending"
      width="100%"
      @commit="value => emit('commit', value)"
      @input="value => emit('input', value)"
    />
    <span v-if="error" class="p-nf-error">{{ error }}</span>
    <span v-else-if="hint" class="p-nf-hint">{{ hint }}</span>
  </label>
</template>

<style scoped>
.p-nf { display: flex; flex-direction: column; gap: 6px; min-width: 0; }

.p-nf-label {
  font-size: var(--text-caption);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 20px;
}

.p-nf-badge { text-transform: none; letter-spacing: 0; }

.p-nf-error { font-size: var(--text-micro); color: var(--danger); }
.p-nf-hint { font-size: var(--text-micro); color: var(--muted); }
</style>
