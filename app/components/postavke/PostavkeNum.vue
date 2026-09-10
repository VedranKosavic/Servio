<script setup lang="ts">
/**
 * A number typed into a table cell or a settings row — a price, a threshold, a
 * quantity per unit, a column on the floor plan.
 *
 * **Why this is not `UiField kind="money"`.** The kit's field re-renders the
 * value from the model on every keystroke, so a half-typed amount is reformatted
 * under the cursor: typing "5" into a price field turns into "5,00" before the
 * next digit lands, and the digit after that goes on the wrong side of the
 * comma. So this keeps the raw text the person is typing and converts **once, on
 * blur** — the same pattern `StockDeliverySheet` uses on the waiter's phone.
 * It also has no visible label, because in a table the column header is the
 * label and repeating it on fourteen rows is noise; the accessible name comes
 * from `label`.
 *
 * Bosnian decimals: both "2,5" and "2.5" are read, because a phone keyboard
 * offers whichever it likes and a person types whichever he has.
 */
import { parseKm } from '#shared/money'

const props = withDefaults(defineProps<{
  /** Feninga for `money`, the plain number otherwise. `null` is an empty field. */
  modelValue: number | null
  kind?: 'money' | 'decimal' | 'int'
  /** The accessible name — "Cijena, Kafa". Never drawn. */
  label: string
  /** The quiet unit after the box: "KM", "g", "s". */
  suffix?: string
  width?: string
  disabled?: boolean
  /** The write is in flight; the field greys out so a second Enter cannot fire. */
  pending?: boolean
  placeholder?: string
}>(), { kind: 'money', disabled: false, pending: false })

const emit = defineEmits<{
  /** The value actually changed. Fires on blur — this is what triggers a write. */
  commit: [value: number | null]
  /**
   * Every keystroke, parsed. **Not** a write: it exists so that a form's primary
   * button can enable itself while the number is still being typed. Without it,
   * clicking *Sačuvaj* straight after the last digit lands on a button that is
   * still disabled (the blur that enables it fires in the same gesture), and
   * the person has to click twice.
   */
  input: [value: number | null]
}>()

/** How the canonical value looks in the box while nobody is typing in it. */
function toText(value: number | null): string {
  if (value === null || value === undefined) return ''
  if (props.kind === 'money') return formatAmount(value)
  return String(value).replace('.', ',')
}

function fromText(text: string): number | null {
  if (text.trim() === '') return null
  if (props.kind === 'money') return parseKm(text)
  const parsed = parseDecimalInput(text)
  if (parsed === null) return null
  return props.kind === 'int' ? Math.round(parsed) : parsed
}

const raw = ref(toText(props.modelValue))
const focused = ref(false)

// A poll or a save can move the value under the field; re-seed it then — but
// never while the owner has the caret in it, which would eat what he is typing.
watch(() => props.modelValue, (value) => {
  if (!focused.value) raw.value = toText(value)
})

function onInput(event: Event) {
  raw.value = (event.target as HTMLInputElement).value
  emit('input', fromText(raw.value))
}

function onBlur() {
  focused.value = false
  const next = fromText(raw.value)
  if (next === props.modelValue) {
    // Unchanged, but possibly typed differently ("5" for 5,00) — tidy it back.
    raw.value = toText(props.modelValue)
    return
  }
  if (next === null && raw.value.trim() !== '') {
    // Unreadable. Put the old value back rather than sending a null nobody meant.
    raw.value = toText(props.modelValue)
    return
  }
  emit('commit', next)
}
</script>

<template>
  <span class="p-num" :style="width ? { width } : undefined">
    <input
      :value="raw"
      class="p-num-input"
      type="text"
      inputmode="decimal"
      :aria-label="label"
      :placeholder="placeholder"
      :disabled="disabled || pending"
      @focus="focused = true"
      @input="onInput"
      @blur="onBlur"
      @keydown.enter="($event.target as HTMLInputElement).blur()"
    >
    <span v-if="suffix" class="p-num-suffix">{{ suffix }}</span>
  </span>
</template>

<style scoped>
.p-num { display: inline-flex; align-items: center; gap: 6px; }

.p-num-input {
  height: 34px;
  width: 100%;
  min-width: 0;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--field-bg);
  padding: 0 8px;
  font: inherit;
  font-size: var(--text-label);
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.p-num-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.p-num-input:disabled { opacity: 0.5; }

.p-num-suffix { font-size: var(--text-caption); color: var(--muted); white-space: nowrap; }

@media (max-width: 1023px) {
  .p-num-input { height: 44px; font-size: var(--text-section); padding: 0 10px; }
  .p-num-suffix { font-size: var(--text-label); }
}
</style>
