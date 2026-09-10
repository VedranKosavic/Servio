<script setup lang="ts">
/**
 * A person on the staff, new or being edited.
 *
 * **No screen in Šank ever shows a PIN that already exists.** A PIN is stored as
 * a scrypt hash with a pepper and there is nothing to show; the only thing this
 * sheet can do with one is set a new one, and only when the person is being
 * created. Afterwards it is *Novi PIN*, which is its own route.
 *
 * `email` belongs to an admin alone — it is the laptop door into `/admin`, and a
 * waiter has no use for one.
 */
import type { Role, UserAdmin } from '#shared/types'
import type { CreateUserBody, UpdateUserBody } from '#shared/schemas'

const props = defineProps<{
  open: boolean
  /** `null` means *Novi radnik*. */
  user: UserAdmin | null
  /** The signed-in admin: he may not switch himself off. */
  meId: string | null
  pending: boolean
  error: string | null
}>()

const emit = defineEmits<{
  close: []
  create: [body: CreateUserBody]
  update: [id: string, patch: UpdateUserBody]
}>()

const ROLES: Array<{ value: Role, label: string }> = [
  { value: 'waiter', label: 'Konobar' },
  { value: 'bartender', label: 'Šanker' },
  { value: 'admin', label: 'Vlasnik' },
]

const name = ref('')
const initials = ref('')
const role = ref<Role>('waiter')
const email = ref('')
const pin = ref('')
const active = ref(true)

watch(() => [props.open, props.user?.id], () => {
  if (!props.open) return
  const user = props.user
  name.value = user?.name ?? ''
  initials.value = user?.initials ?? ''
  role.value = user?.role ?? 'waiter'
  email.value = user?.email ?? ''
  pin.value = ''
  active.value = user?.active ?? true
}, { immediate: true })

/** Initials are what a colleague's table tile shows: at most three characters. */
const initialsError = computed(() =>
  initials.value.trim().length > 3 ? 'Najviše tri slova.' : null)

/** Four or six digits, both legal for every role; six is advice, not a rule. */
const pinError = computed(() => {
  if (props.user) return null
  if (pin.value === '') return null
  return /^\d{4}$|^\d{6}$/.test(pin.value) ? null : 'PIN je 4 ili 6 cifara.'
})

const isSelf = computed(() => props.user !== null && props.user.id === props.meId)

const canSave = computed(() => {
  if (name.value.trim() === '' || initials.value.trim() === '') return false
  if (initialsError.value) return false
  if (!props.user) return /^\d{4}$|^\d{6}$/.test(pin.value)
  return pinError.value === null
})

function save() {
  if (!canSave.value) return

  if (!props.user) {
    emit('create', {
      name: name.value.trim(),
      initials: initials.value.trim(),
      role: role.value,
      pin: pin.value,
      email: role.value === 'admin' && email.value.trim() ? email.value.trim() : null,
    })
    return
  }

  // Only what actually moved: the server refuses an empty patch rather than
  // writing a Dnevnik entry that says nothing changed.
  const patch: UpdateUserBody = {}
  if (name.value.trim() !== props.user.name) patch.name = name.value.trim()
  if (initials.value.trim() !== props.user.initials) patch.initials = initials.value.trim()
  if (role.value !== props.user.role) patch.role = role.value
  if (active.value !== props.user.active) patch.active = active.value

  const nextEmail = role.value === 'admin' && email.value.trim() ? email.value.trim() : null
  if (nextEmail !== props.user.email) patch.email = nextEmail

  if (Object.keys(patch).length === 0) {
    emit('close')
    return
  }
  emit('update', props.user.id, patch)
}
</script>

<template>
  <UiSheet
    :open="open"
    :title="user ? `Radnik · ${user.name}` : 'Novi radnik'"
    :pending="pending"
    @close="emit('close')"
  >
    <p v-if="error" class="p-error" role="alert">{{ error }}</p>

    <UiField v-model="name" label="Ime" placeholder="Amar" />

    <UiField
      v-model="initials"
      label="Inicijali"
      placeholder="AM"
      :error="initialsError ?? undefined"
      hint="Kolege ih vide na tuđem stolu."
    />

    <UiField
      :model-value="role"
      label="Uloga"
      kind="select"
      :options="ROLES"
      @update:model-value="value => role = value as Role"
    />

    <UiField
      v-if="role === 'admin'"
      v-model="email"
      label="E-mail"
      kind="email"
      autocomplete="off"
      hint="Prijava na laptop. Lozinku vlasnik postavlja sam."
    />

    <UiField
      v-if="!user"
      v-model="pin"
      label="PIN"
      placeholder="4 ili 6 cifara"
      autocomplete="off"
      :error="pinError ?? undefined"
      hint="Bez PIN-a se ne može prijaviti ni na jedan telefon."
    />

    <div v-if="user" class="p-row">
      <span class="p-caption">Aktivan</span>
      <PostavkeToggle
        v-model="active"
        label="Aktivan radnik"
        words
        :disabled="isSelf"
      />
      <span v-if="isSelf" class="p-hint">Ne možeš deaktivirati sam sebe.</span>
    </div>

    <p v-if="user" class="p-hint">
      Radnik se nikad ne briše — ugašen radnik i dalje stoji na svojim starim
      turama i u svojoj smjeni.
    </p>
      <template #footer>
        <UiButton variant="ghost" @click="emit('close')">Odustani</UiButton>
        <UiButton
          variant="primary"
          :pending="pending"
          :disabled="!canSave"
          @click="save"
        >{{ user ? 'Sačuvaj' : 'Dodaj' }}</UiButton>
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
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  font-weight: 600;
}

.p-hint { margin: 0; font-size: 13px; color: var(--muted); }
</style>
