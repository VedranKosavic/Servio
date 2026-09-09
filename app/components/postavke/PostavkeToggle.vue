<script setup lang="ts">
/**
 * A yes/no switch — *aktivan*, *piće za osoblje*, *ko odobrava*.
 *
 * It is a real `<input type="checkbox">` under a painted track, not a `<div>`
 * with a click handler: that is what makes Space toggle it, a screen reader
 * announce "potvrdni okvir, označeno", and a `<label>` click land on the right
 * control. The kit has no checkbox — `UiField` covers text, numbers and selects
 * — so the switch lives here, in the package that needs it.
 *
 * **Colour never carries the meaning alone**: the state is also a word beside
 * the track (`onLabel` / `offLabel`), or the visible label the caller passes.
 */
const props = withDefaults(defineProps<{
  modelValue: boolean
  /** Read out by a screen reader when the row's own text is not enough. */
  label: string
  /** Show the state as a word next to the switch. */
  words?: boolean
  onLabel?: string
  offLabel?: string
  disabled?: boolean
}>(), { words: false, onLabel: 'da', offLabel: 'ne', disabled: false })

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

/**
 * **The checkbox is not allowed to decide its own state.**
 *
 * A browser flips a checkbox the instant it is clicked, before anybody has
 * asked the server. If the write is then refused — deactivating a table with
 * guests at it, say — the parent re-renders with the value unchanged, Vue sees
 * no change to patch, and the switch is left showing a state the database does
 * not have. So the DOM is put straight back the way the model has it, and only
 * a new `modelValue` from the parent ever moves it.
 */
function onChange(event: Event) {
  const input = event.target as HTMLInputElement
  const wanted = input.checked
  input.checked = props.modelValue
  emit('update:modelValue', wanted)
}
</script>

<template>
  <label class="p-toggle" :class="{ off: disabled }">
    <input
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      :aria-label="label"
      @change="onChange"
    >
    <span class="p-track" aria-hidden="true"><span class="p-knob" /></span>
    <span v-if="words" class="p-word">{{ modelValue ? onLabel : offLabel }}</span>
  </label>
</template>

<style scoped>
.p-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  /* A thumb needs 44 px even when the painted track is 24 px tall. */
  min-height: 44px;
}

.p-toggle.off { cursor: default; opacity: 0.5; }

/* The input stays in the layout (and focusable) but is drawn by the track. */
.p-toggle input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  margin: 0;
}

.p-track {
  width: 40px;
  height: 24px;
  border-radius: 12px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  display: inline-flex;
  align-items: center;
  padding: 2px;
  flex-shrink: 0;
}

.p-knob {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--field-bg);
  border: 1px solid var(--line);
  transition: transform 0.12s ease;
}

.p-toggle input:checked ~ .p-track { background: var(--good); border-color: var(--good); }
.p-toggle input:checked ~ .p-track .p-knob { transform: translateX(16px); border-color: var(--good); }
.p-toggle input:focus-visible ~ .p-track { outline: 2px solid var(--accent); outline-offset: 2px; }

.p-word { font-size: 13px; color: var(--ink-2); font-weight: 600; }

@media (prefers-reduced-motion: reduce) {
  .p-knob { transition: none; }
}

@media (max-width: 1023px) {
  .p-track { width: 46px; height: 28px; border-radius: 14px; }
  .p-knob { width: 22px; height: 22px; }
  .p-toggle input:checked ~ .p-track .p-knob { transform: translateX(18px); }
  .p-word { font-size: 15px; }
}
</style>
