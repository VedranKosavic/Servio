<script setup lang="ts">
/**
 * A labelled input with its error line.
 *
 * `kind: 'decimal'` is the one worth knowing about: it sets
 * `inputmode="decimal"` so a phone shows the numeric keypad, and it parses
 * through `parseDecimalInput`, which accepts both "2,5" and "2.5" — a keyboard
 * offers whichever it likes and a person types whichever he has.
 *
 * Money is entered in **KM** and emitted in **feninga**: `kind: 'money'` emits
 * `1250` for "12,50". Nothing downstream ever sees a float.
 */
const props = withDefaults(defineProps<{
  label: string
  modelValue: string | number | null
  kind?: 'text' | 'password' | 'email' | 'decimal' | 'money' | 'date' | 'textarea' | 'select'
  /** The Bosnian sentence under the field. Rendered in `--danger`. */
  error?: string
  hint?: string
  placeholder?: string
  autocomplete?: string
  disabled?: boolean
  options?: Array<{ value: string, label: string }>
}>(), { kind: 'text' })

const emit = defineEmits<{ 'update:modelValue': [value: string | number | null] }>()

const id = useId()

const inputType = computed(() => {
  switch (props.kind) {
    case 'password': return 'password'
    case 'email': return 'email'
    case 'date': return 'date'
    case 'decimal':
    case 'money': return 'text'
    default: return 'text'
  }
})

/** A money field shows KM, so 1250 feninga renders as "12,50". */
const shown = computed(() => {
  if (props.modelValue === null || props.modelValue === undefined) return ''
  if (props.kind === 'money' && typeof props.modelValue === 'number') {
    return formatAmount(props.modelValue)
  }
  return String(props.modelValue)
})

function onInput(event: Event) {
  const raw = (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value
  if (props.kind === 'money') {
    const km = parseDecimalInput(raw)
    emit('update:modelValue', km === null ? null : Math.round(km * 100))
    return
  }
  if (props.kind === 'decimal') {
    emit('update:modelValue', parseDecimalInput(raw))
    return
  }
  emit('update:modelValue', raw)
}
</script>

<template>
  <div class="a-field">
    <label :for="id">{{ label }}</label>

    <select
      v-if="kind === 'select'"
      :id="id"
      class="a-input"
      :value="shown"
      :disabled="disabled"
      @change="onInput"
    >
      <option v-for="option in options ?? []" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>

    <textarea
      v-else-if="kind === 'textarea'"
      :id="id"
      class="a-input a-textarea"
      :value="shown"
      :placeholder="placeholder"
      :disabled="disabled"
      rows="3"
      @input="onInput"
    />

    <input
      v-else
      :id="id"
      class="a-input"
      :class="{ num: kind === 'decimal' || kind === 'money' }"
      :type="inputType"
      :inputmode="kind === 'decimal' || kind === 'money' ? 'decimal' : undefined"
      :value="shown"
      :placeholder="placeholder"
      :autocomplete="autocomplete"
      :disabled="disabled"
      :aria-invalid="error ? 'true' : undefined"
      @input="onInput"
    >

    <p v-if="error" class="a-field-error">{{ error }}</p>
    <p v-else-if="hint" class="a-field-hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.a-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.a-field label {
  font-size: var(--text-caption);
  line-height: 1.3;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--muted);
  font-weight: 600;
}

.a-input {
  height: 40px;
  border-radius: var(--radius-field);
  border: 1px solid var(--line);
  background: var(--field-bg);
  padding: 0 12px;
  font: inherit;
  font-size: var(--text-body);
  color: var(--ink);
  width: 100%;
  transition: border-color var(--dur-fast) var(--ease-standard);
}

.a-input::placeholder { color: var(--muted); }
.a-input:hover:not(:disabled) { border-color: var(--muted); }

/* The ring is the copper that works as ink on paper, not the fill copper —
   `--accent` at 2 px around a white field is a highlighter pen. */
.a-input:focus-visible {
  outline: 2px solid var(--accent-text);
  outline-offset: -1px;
  border-color: var(--accent-line);
}

.a-input.num { font-variant-numeric: tabular-nums; }
.a-input:disabled { background: var(--surface-2); color: var(--muted); }
.a-textarea { height: auto; min-height: 84px; padding: 10px 12px; line-height: 1.45; }

.a-field-error { margin: 0; font-size: var(--text-micro); color: var(--danger); font-weight: 500; }
.a-field-hint { margin: 0; font-size: var(--text-micro); color: var(--muted); }

@media (max-width: 1023px) {
  /* 16 px, because anything smaller makes iOS Safari zoom the page on focus. */
  .a-input { height: 44px; font-size: var(--text-section); }
}

/* The waiter and bartender floor is 48 px — see the note in `UiButton`. */
html:not([data-theme='light']) .a-input {
  height: 48px;
  font-size: var(--text-body);
}

html:not([data-theme='light']) .a-textarea { height: auto; }
</style>
