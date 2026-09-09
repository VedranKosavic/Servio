<script setup lang="ts">
/**
 * *Novi uređaj* — the six characters the owner reads out across the bar.
 *
 * The code is a credential with a short life: ten minutes, two uses. Two rather
 * than one because the first attempt is often a typo across a noisy room; ten
 * minutes because a code left on a screen is a way into the app. It is shown
 * once, large, and it is not stored anywhere the screen can ask for it again —
 * the server keeps only a hash.
 *
 * A *lični* phone must name whose it is; a *zajednički* one is the bar's.
 */
import type { EnrolCodeResult, UserAdmin } from '#shared/types'
import type { CreateEnrolCodeBody } from '#shared/schemas'

const props = defineProps<{
  open: boolean
  users: UserAdmin[]
  pending: boolean
  error: string | null
  result: EnrolCodeResult | null
}>()

const emit = defineEmits<{ close: [], save: [body: CreateEnrolCodeBody] }>()

const label = ref('')
const mode = ref<'personal' | 'shared'>('shared')
const boundUserId = ref('')

const userOptions = computed(() => props.users
  .filter(user => user.active)
  .map(user => ({ value: user.id, label: `${user.name} · ${user.initials}` })))

watch(() => props.open, (open) => {
  if (!open) return
  label.value = ''
  mode.value = 'shared'
  boundUserId.value = userOptions.value[0]?.value ?? ''
})

const canSave = computed(() =>
  label.value.trim() !== '' && (mode.value === 'shared' || boundUserId.value !== ''))

function save() {
  if (!canSave.value) return
  emit('save', {
    label: label.value.trim(),
    mode: mode.value,
    ...(mode.value === 'personal' ? { bound_user_id: boundUserId.value } : {}),
  })
}
</script>

<template>
  <UiSheet
    :open="open"
    title="Novi uređaj"
    :pending="pending"
    @close="emit('close')"
  >
    <template #footer>
      <UiButton v-if="result" variant="primary" @click="emit('close')">Zatvori</UiButton>
      <template v-else>
        <UiButton variant="ghost" @click="emit('close')">Odustani</UiButton>
        <UiButton
          variant="primary"
          :pending="pending"
          :disabled="!canSave"
          @click="save"
        >Napravi kod</UiButton>
      </template>
    </template>

    <template v-if="result">
      <p class="p-caption">Kod za prijavu uređaja</p>
      <p class="p-code">{{ result.code }}</p>
      <p class="p-hint">
        Vrijedi do {{ timeBs(result.expires_at) }} · {{ result.uses_left }} pokušaja.
        Ukucaj ga na telefonu i kod nestaje.
      </p>
    </template>

    <template v-else>
      <p v-if="error" class="p-error" role="alert">{{ error }}</p>

      <UiField v-model="label" label="Naziv uređaja" placeholder="Amarov telefon" />

      <div class="p-row">
        <span class="p-caption">Vrsta</span>
        <UiSeg
          :model-value="mode"
          label="Vrsta uređaja"
          :options="[
            { value: 'shared', label: 'Zajednički' },
            { value: 'personal', label: 'Lični' },
          ]"
          @update:model-value="value => mode = value as 'personal' | 'shared'"
        />
      </div>

      <UiField
        v-if="mode === 'personal'"
        :model-value="boundUserId"
        label="Čiji je"
        kind="select"
        :options="userOptions"
        @update:model-value="value => boundUserId = String(value)"
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
  font-size: 13px;
}

.p-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }

.p-caption {
  margin: 0;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  font-weight: 600;
}

/* Big enough to read out from the other side of the bar. */
.p-code {
  margin: 0;
  font-family: var(--font-title);
  font-size: 48px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-align: center;
  color: var(--accent-ink);
  background: var(--accent-soft);
  border-radius: 12px;
  padding: 16px 8px;
  font-variant-numeric: tabular-nums;
}

.p-hint { margin: 0; font-size: 13px; color: var(--muted); }
</style>
