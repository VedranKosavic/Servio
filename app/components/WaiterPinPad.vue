<script setup lang="ts">
/**
 * The PIN pad — the login screen's whole screen, and the approver sheets' pad.
 *
 * Two callers, two shapes, one keyboard:
 *
 * - **The login screen** (`pages/index.vue`) draws it nameless and full size.
 *   The digits identify the person, so there is nobody to put a face on above
 *   the dots, and the corner key is *Obriši* rather than *Nazad*: there is no
 *   list behind this screen to go back to.
 * - **The approver sheets** (*Storno*, *Otpis*) draw it named and compact, over
 *   a person they already picked, whose `pin_len` they already know.
 *
 * **It submits on the last digit.** There is no *Prijavi se* button, and that is
 * deliberate: a person standing at the bar with a tray in one hand taps four
 * times and is in. A confirm button would be a fifth tap that says nothing the
 * fourth one did not already say.
 *
 * **`pinLen` and `maxLen`, and why the login pad needs both.** A named pad knows
 * the length (`maxLen` defaults to `pinLen`) and fires on it. The login pad does
 * not — the account is unknown until the digits have been compared — so it
 * assumes four, which every account in the café has, and only when four have
 * already been refused does the caller raise `maxLen` to 6. The pad then grows
 * two dots and a *Potvrdi*, because a six-digit PIN whose first four are
 * somebody else's must never be submitted four digits at a time.
 *
 * **The layout is a thumb's layout** (docs/DESIGN.md §3). The keys sit in one
 * block no wider than a hand, pinned to the bottom of the composition rather
 * than centred in it, so the whole pad falls inside the arc a thumb sweeps when
 * the phone is held in one hand.
 *
 * The lockout is its own element, not an error message: a locked pad with no
 * clock on it is indistinguishable from a broken one, so the seconds tick down
 * in tabular figures inside a warn-toned strip while the keys go quiet.
 */
const props = withDefaults(defineProps<{
  /** The person, when there is one. The login pad has nobody to name. */
  name?: string | null
  initials?: string | null
  /** Rendered quietly under the name: *vlasnik*, *radnik*. */
  role?: string | null
  /** How many digits the pad assumes — 4 for staff, 6 for an admin. */
  pinLen: 4 | 6
  /**
   * The longest PIN this pad will accept. Defaults to `pinLen`, which is the
   * named case: the length is known and the last digit submits. Raise it above
   * `pinLen` and the pad stops firing on its own and grows a *Potvrdi*.
   */
  maxLen?: 4 | 6
  /** `screen` is the login pad: bigger keys, more air. `sheet` is the default. */
  size?: 'sheet' | 'screen'
  /**
   * What the bottom-left key does. `cancel` is *Nazad*, out of a sheet;
   * `clear` is *Obriši*, which empties the dots — the login screen has nothing
   * behind it to go back to.
   */
  corner?: 'cancel' | 'clear'
  busy?: boolean
  /** The sentence from the server: wrong PIN, not your phone, no network. */
  error?: string | null
  /**
   * Seconds left on the server's lockout. Above zero the pad refuses taps and
   * shows the countdown; the parent owns the timer because the lockout is
   * counted against `(device, user)` and has to survive this component.
   */
  lockedFor?: number
  /**
   * A quiet line under the name, for something the pad must say before the
   * digits are typed rather than after — *"Posuđuješ tuđi telefon"* is the one
   * case (S10, *Drugi konobar*): a 2-hour borrowed session is a different thing
   * from signing in, and finding that out afterwards is finding it out too late.
   */
  note?: string | null
}>(), {
  name: null,
  initials: null,
  role: null,
  maxLen: undefined,
  size: 'sheet',
  corner: 'cancel',
  busy: false,
  error: null,
  lockedFor: 0,
  note: null,
})

const emit = defineEmits<{
  submit: [pin: string]
  cancel: []
}>()

const digits = ref('')

/** `maxLen` is optional so that neither approver sheet has to pass it. */
const ceiling = computed<4 | 6>(() => props.maxLen ?? props.pinLen)

/**
 * A pad that cannot fire on its own needs a key that does. It appears only in
 * the long case, so the ordinary four-digit login is still four taps.
 */
const confirms = computed(() => ceiling.value > props.pinLen)
const canConfirm = computed(() => digits.value.length >= props.pinLen)

/**
 * The dots are `pinLen` of them until the person types past that, and then one
 * per digit up to the ceiling — so the row grows under the finger instead of
 * showing two empty slots nobody is expected to fill.
 */
const dots = computed(() => {
  const slots = Math.min(ceiling.value, Math.max(props.pinLen, digits.value.length))
  return Array.from({ length: slots }, (_, i) => i < digits.value.length)
})

const locked = computed(() => props.lockedFor > 0)
const disabled = computed(() => props.busy || locked.value)

// A rejected PIN clears the pad. Leaving four filled dots behind would make the
// next tap look like a fifth digit rather than a fresh start.
watch(() => [props.error, props.lockedFor] as const, ([message, seconds]) => {
  if (message || (seconds ?? 0) > 0) digits.value = ''
})

function tap(digit: string) {
  if (disabled.value || digits.value.length >= ceiling.value) return
  digits.value += digit
  // The last digit is the submit. The dots stay filled while the request is in
  // flight, so the pad looks like it is thinking rather than like it lost input.
  if (digits.value.length === ceiling.value) emit('submit', digits.value)
}

function confirm() {
  if (disabled.value || !canConfirm.value) return
  emit('submit', digits.value)
}

function back() {
  if (disabled.value) return
  digits.value = digits.value.slice(0, -1)
}

/** *Obriši* on the login pad: the whole entry, not one digit. */
function clear() {
  if (disabled.value) return
  digits.value = ''
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
</script>

<template>
  <div class="pad" :class="{ 'pad-screen': size === 'screen' }">
    <div v-if="name" class="pad-who">
      <span v-if="initials" class="avatar avatar-lg avatar-accent">{{ initials }}</span>
      <h2 class="page-title pad-name">{{ name }}</h2>
      <p v-if="role" class="eyebrow">{{ role }}</p>
    </div>

    <!-- The dots: how many digits are in, never which ones. -->
    <div class="pad-dots" aria-label="Uneseni PIN">
      <span
        v-for="(filled, index) in dots"
        :key="index"
        class="pad-dot"
        :class="{ on: filled }"
      />
    </div>

    <p v-if="note" class="note note-warn pad-msg">
      {{ note }}
    </p>

    <p v-if="locked" class="note note-warn pad-msg" role="alert">
      PIN je zaključan. Pokušaj ponovo za <span class="num pad-count">{{ lockedFor }}</span> s.
    </p>
    <p v-else-if="error" class="note note-danger pad-msg" role="alert">
      {{ error }}
    </p>

    <div class="pad-keys">
      <button
        v-for="key in KEYS"
        :key="key"
        type="button"
        class="pad-key num"
        :disabled="disabled"
        @click="tap(key)"
      >{{ key }}</button>

      <button
        v-if="corner === 'clear'"
        type="button"
        class="pad-key pad-key-quiet"
        :disabled="disabled || digits.length === 0"
        @click="clear"
      >Obriši</button>
      <button
        v-else
        type="button"
        class="pad-key pad-key-quiet"
        :disabled="busy"
        @click="emit('cancel')"
      >Nazad</button>

      <button
        type="button"
        class="pad-key num"
        :disabled="disabled"
        @click="tap('0')"
      >0</button>

      <button
        type="button"
        class="pad-key pad-key-quiet"
        :disabled="disabled"
        aria-label="Obriši zadnju cifru"
        @click="back"
      >
        <svg
          width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
        ><path d="M20 6H9l-5 6 5 6h11a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1zM16 10l-4 4M12 10l4 4" /></svg>
      </button>
    </div>

    <!-- Only in the long case: see `maxLen` above. -->
    <button
      v-if="confirms"
      type="button"
      class="btn btn-primary btn-lg pad-confirm"
      :disabled="disabled || !canConfirm"
      @click="confirm"
    >Potvrdi</button>
  </div>
</template>

<style scoped>
.pad {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
}

.pad-who {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.pad-name { margin: 0; }

/* ---- the dots ---------------------------------------------------------- */

.pad-dots {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 14px;
}

.pad-dot {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  border: 1.5px solid var(--line);
  background: var(--surface-2);
  transition:
    background var(--dur-tap) var(--ease-out-soft),
    border-color var(--dur-tap) var(--ease-out-soft),
    transform var(--dur-tap) var(--ease-out-soft);
}

.pad-dot.on {
  background: var(--accent);
  border-color: var(--accent);
  transform: scale(1.15);
}

.pad-msg {
  width: 100%;
  max-width: 320px;
  margin: 0;
  text-align: center;
}

.pad-count { font-weight: 700; }

/* ---- the keys ---------------------------------------------------------- */

.pad-keys {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  width: 100%;
  max-width: 300px;
}

.pad-confirm { width: 100%; max-width: 300px; }

.pad-key {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 64px;
  border-radius: var(--radius-control);
  border: 1px solid var(--line-soft);
  background: var(--surface-2);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-title);
  font-weight: 600;
  cursor: pointer;
  transition:
    background var(--dur-tap) var(--ease-standard),
    transform var(--dur-tap) var(--ease-standard);
}

.pad-key:active:not(:disabled) {
  background: var(--surface-3);
  transform: scale(0.95);
}

/* The two corner keys are not digits and must not look like digits: no material
   behind them, so the nine keys read as one block. */
.pad-key-quiet {
  background: transparent;
  border-color: transparent;
  color: var(--ink-2);
  font-size: var(--text-label);
  font-weight: 600;
}

.pad-key-quiet:active:not(:disabled) { background: var(--surface-2); }

.pad-key:disabled { opacity: 0.4; cursor: default; }

/* ---- the login pad ------------------------------------------------------ */

/* The pad *is* the screen there, so it gets the width the hand can reach and a
   key tall enough to hit without looking. Everything else is the same object. */
.pad-screen { gap: 22px; }
.pad-screen .pad-keys,
.pad-screen .pad-confirm { max-width: 328px; }
.pad-screen .pad-key { height: 68px; }
.pad-screen .pad-dots { gap: 16px; }
.pad-screen .pad-dot { width: 14px; height: 14px; }

@media (min-width: 640px) {
  .pad-screen .pad-key { height: 72px; }
}
</style>