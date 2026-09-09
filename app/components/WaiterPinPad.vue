<script setup lang="ts">
/**
 * The PIN pad on the lock screen.
 *
 * Four digits for a waiter or a bartender, six for an admin — the length comes
 * from `MeUser.pin_len`, so the pad draws the right number of dots without
 * knowing anything about roles.
 *
 * **It submits on the last digit.** There is no *Prijavi se* button, and that is
 * deliberate: a person standing at the bar with a tray in one hand taps four
 * times and is in. A confirm button would be a fifth tap that says nothing the
 * fourth one did not already say.
 *
 * The keys are 64 px and laid out like a phone dialler, because that is the
 * arrangement every thumb in the café already knows.
 */
const props = withDefaults(defineProps<{
  name: string
  initials: string
  /** 4 for staff, 6 for an admin. */
  pinLen: 4 | 6
  busy?: boolean
  /** The sentence from the server: wrong PIN, locked, not your phone. */
  error?: string | null
  /** While the lockout is counting down, the pad refuses taps. */
  locked?: boolean
}>(), { busy: false, error: null, locked: false })

const emit = defineEmits<{
  submit: [pin: string]
  cancel: []
}>()

const digits = ref('')
const dots = computed(() => Array.from({ length: props.pinLen }, (_, i) => i < digits.value.length))
const disabled = computed(() => props.busy || props.locked)

// A rejected PIN clears the pad. Leaving four filled dots behind would make the
// next tap look like a fifth digit rather than a fresh start.
watch(() => props.error, (message) => {
  if (message) digits.value = ''
})

function tap(digit: string) {
  if (disabled.value || digits.value.length >= props.pinLen) return
  digits.value += digit
  // The last digit is the submit. The dots stay filled while the request is in
  // flight, so the pad looks like it is thinking rather than like it lost input.
  if (digits.value.length === props.pinLen) emit('submit', digits.value)
}

function back() {
  if (disabled.value) return
  digits.value = digits.value.slice(0, -1)
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
</script>

<template>
  <div class="flex flex-col items-center gap-5">
    <div class="flex flex-col items-center gap-2">
      <span class="flex size-14 items-center justify-center rounded-full bg-accent text-lg font-bold text-accent-ink">
        {{ initials }}
      </span>
      <h2 class="text-2xl font-semibold">
        {{ name }}
      </h2>
      <p class="text-[15px] text-text-2">
        Unesi PIN
      </p>
    </div>

    <!-- The dots: how many digits are in, never which ones. -->
    <div class="flex items-center gap-3.5" aria-label="Uneseni PIN">
      <span
        v-for="(filled, index) in dots"
        :key="index"
        class="size-3.5 rounded-full border-2"
        :class="filled ? 'border-accent bg-accent' : 'border-line bg-transparent'"
      />
    </div>

    <p
      v-if="error"
      class="min-h-6 w-full rounded-xl bg-danger-soft px-3 py-2 text-center text-[15px] text-danger"
      role="alert"
    >
      {{ error }}
    </p>

    <div class="grid w-full max-w-[300px] grid-cols-3 gap-3">
      <button
        v-for="key in KEYS"
        :key="key"
        type="button"
        class="num h-16 rounded-2xl bg-surface-2 text-2xl font-semibold text-text disabled:opacity-40"
        :disabled="disabled"
        @click="tap(key)"
      >
        {{ key }}
      </button>

      <button
        type="button"
        class="h-16 rounded-2xl text-[15px] font-semibold text-text-2 disabled:opacity-40"
        :disabled="busy"
        @click="emit('cancel')"
      >
        Nazad
      </button>

      <button
        type="button"
        class="num h-16 rounded-2xl bg-surface-2 text-2xl font-semibold text-text disabled:opacity-40"
        :disabled="disabled"
        @click="tap('0')"
      >
        0
      </button>

      <button
        type="button"
        class="flex h-16 items-center justify-center rounded-2xl text-text-2 disabled:opacity-40"
        :disabled="disabled"
        aria-label="Obriši"
        @click="back"
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 6H9l-5 6 5 6h11a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1zM16 10l-4 4M12 10l4 4" />
        </svg>
      </button>
    </div>
  </div>
</template>
