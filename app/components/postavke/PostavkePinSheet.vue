<script setup lang="ts">
/**
 * *Novi PIN* — the admin gives somebody a PIN, standing next to them.
 *
 * The one route that writes a PIN also clears the device lock the old one left
 * behind, which is why the answer names the phones it unlocked: a waiter who
 * fat-fingered his PIN fifteen times has a locked phone, and a new PIN is the
 * fix. Nothing here echoes a hash and nothing shows the old PIN — there is no
 * old PIN to show, only a scrypt hash with a pepper.
 */
import type { PinResetResult, UserAdmin } from '#shared/types'

const props = defineProps<{
  open: boolean
  user: UserAdmin | null
  pending: boolean
  error: string | null
  /** The answer, once the reset went through. */
  result: PinResetResult | null
  /**
   * The café's PIN length — every active PIN in a venue has the same number of
   * digits, because the pad fires on a fixed number of taps. `null` only while
   * nobody has one at all.
   */
  pinLen: 4 | 6 | null
}>()

const emit = defineEmits<{ close: [], save: [pin: string] }>()

const pin = ref('')

watch(() => props.open, (open) => { if (open) pin.value = '' })

const rule = computed(() => (props.pinLen
  ? new RegExp(`^\\d{${props.pinLen}}$`)
  : /^\d{4}$|^\d{6}$/))

const hint = computed(() => (props.pinLen ? `${props.pinLen} cifre` : '4 ili 6 cifara'))

const valid = computed(() => rule.value.test(pin.value))
const error = computed(() => {
  if (pin.value === '' || valid.value) return null
  return props.pinLen
    ? `Svi PIN-ovi u lokalu imaju ${props.pinLen} cifre.`
    : 'PIN je 4 ili 6 cifara.'
})
</script>

<template>
  <UiSheet
    :open="open"
    :title="user ? `Novi PIN · ${user.name}` : 'Novi PIN'"
    :pending="pending"
    :content-key="result ? 'done' : 'form'"
    @close="emit('close')"
  >
    <template #footer>
      <UiButton v-if="result" variant="primary" @click="emit('close')">Zatvori</UiButton>
      <template v-else>
        <UiButton variant="ghost" @click="emit('close')">Odustani</UiButton>
        <UiButton
          variant="primary"
          :pending="pending"
          :disabled="!valid"
          @click="emit('save', pin)"
        >Postavi PIN</UiButton>
      </template>
    </template>

    <template v-if="result">
      <p class="p-ok">PIN je postavljen.</p>
      <p v-if="result.unlocked.length" class="p-hint">
        Otključano uređaja: {{ result.unlocked.length }}.
      </p>
      <p v-else class="p-hint">Nijedan uređaj nije bio zaključan.</p>
    </template>

    <template v-else>
      <p v-if="error" class="p-error" role="alert">{{ error }}</p>
      <p v-else-if="props.error" class="p-error" role="alert">{{ props.error }}</p>

      <UiField
        v-model="pin"
        label="PIN"
        :placeholder="hint"
        autocomplete="off"
        hint="Reci ga radniku uživo. Nigdje se ne prikazuje ponovo."
      />
    </template>
  </UiSheet>
</template>

<style scoped>
.p-error {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: var(--text-micro);
}

.p-ok {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--good-soft);
  color: var(--good);
  font-size: var(--text-label);
  font-weight: 600;
}

.p-hint { margin: 0; font-size: var(--text-micro); color: var(--muted); }
</style>
