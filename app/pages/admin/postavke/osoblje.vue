<script setup lang="ts">
/**
 * *Osoblje* — who works here, what they may do, and who can log in.
 *
 * Nobody is ever deleted: a waiter who left in March is still the actor on every
 * round he locked, and a foreign key that stops resolving is a shift report that
 * silently loses a person. So the way out is *Aktivan* off — and an admin cannot
 * do that to himself, because he would be locking the only door into `/admin`.
 *
 * **No response here carries a hash and no screen shows one.** The PIN column
 * says whether one exists and how many dots the pad draws, and nothing else.
 */
import type { PinResetResult, UserAdmin } from '#shared/types'
import type { CreateUserBody, UpdateUserBody } from '#shared/schemas'
// The one map, in `shared/`. This file used to keep its own copy — and it still
// said `waiter` / `bartender`, two keys that stopped being roles in 0005, so the
// *Uloga* column rendered `undefined` for every radnik. A local copy of a shared
// table is a blank cell waiting for the next rename; `api-shapes.test.ts` now
// pins the shared one's keys to exactly `admin` and `radnik`.
import { ROLE_LABELS } from '#shared/landing'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Osoblje' })

const api = useAdminApi()
const me = useMe()

const users = ref<UserAdmin[]>([])

const loading = ref(true)
const error = ref<string | null>(null)

const editing = ref<UserAdmin | null>(null)
const sheetOpen = ref(false)
const sheetPending = ref(false)
const sheetError = ref<string | null>(null)

const pinFor = ref<UserAdmin | null>(null)
const pinPending = ref(false)
const pinError = ref<string | null>(null)
const pinResult = ref<PinResetResult | null>(null)

/**
 * The café's PIN length — one number, because every active PIN in a venue has
 * to have the same number of digits (the pad fires on a fixed number of taps,
 * so a six-digit PIN whose first four are a colleague's would sign the
 * colleague in). `null` while nobody else has a PIN: then either length is
 * free, and the one set fixes it.
 *
 * `except` is the person being given this PIN, and it matters in exactly one
 * café: the one where he is the only account with a PIN at all, where the rule
 * has nobody to disagree with him and the server would allow either length.
 * Being stricter than the server here would be a screen refusing something the
 * app permits.
 */
function pinLenExcept(except: string | null): 4 | 6 | null {
  return users.value.find(u => u.active && u.has_pin && u.id !== except)?.pin_len ?? null
}

const newUserPinLen = computed(() => pinLenExcept(null))
const resetPinLen = computed(() => pinLenExcept(pinFor.value?.id ?? null))

async function load() {
  try {
    users.value = await api.getUsers()
    error.value = null
  } catch (err) {
    error.value = apiErrorText(err, 'Osoblje se nije učitalo.')
  } finally {
    loading.value = false
  }
}

onMounted(() => { void load() })

useAdminChanges({
  onEntity: (entity) => { if (entity === 'user') void load() },
})

const columns = [
  { key: 'ime', label: 'Ime' },
  { key: 'inicijali', label: 'Inicijali', width: '100px' },
  { key: 'uloga', label: 'Uloga', width: '120px' },
  { key: 'pin', label: 'PIN', width: '150px' },
  { key: 'email', label: 'E-mail' },
  { key: 'stanje', label: 'Stanje', width: '110px' },
  { key: 'akcije', label: '', align: 'r' as const, width: '200px' },
]

function open(user: UserAdmin | null) {
  editing.value = user
  sheetError.value = null
  sheetOpen.value = true
}

function openPin(user: UserAdmin) {
  pinFor.value = user
  pinError.value = null
  pinResult.value = null
}

async function create(body: CreateUserBody) {
  sheetPending.value = true
  try {
    await api.createUser(body)
    sheetOpen.value = false
    await load()
  } catch (err) {
    sheetError.value = apiErrorText(err, 'Radnik nije dodan.')
  } finally {
    sheetPending.value = false
  }
}

async function update(id: string, patch: UpdateUserBody) {
  sheetPending.value = true
  try {
    await api.updateUser(id, patch)
    sheetOpen.value = false
    await load()
  } catch (err) {
    sheetError.value = apiErrorText(err, 'Izmjena nije snimljena.')
  } finally {
    sheetPending.value = false
  }
}

async function resetPin(pin: string) {
  const user = pinFor.value
  if (!user) return
  pinPending.value = true
  try {
    pinResult.value = await api.resetUserPin(user.id, { pin })
    pinError.value = null
    await load()
  } catch (err) {
    pinError.value = apiErrorText(err, 'PIN nije postavljen.')
  } finally {
    pinPending.value = false
  }
}
</script>

<template>
  <PostavkePage
    title="Osoblje"
    sub="Ko radi, šta smije i ko se može prijaviti"
    :error="error"
  >
    <template #actions>
      <UiButton variant="primary" @click="open(null)">Novi radnik</UiButton>
    </template>

    <UiCard title="Osoblje" :count="users.length">
      <UiTable :columns="columns" :loading="loading" empty="Nema radnika.">
        <tr v-for="user in users" :key="user.id" :class="{ off: !user.active }">
          <td><strong>{{ user.name }}</strong></td>
          <td>{{ user.initials }}</td>
          <td>{{ ROLE_LABELS[user.role] }}</td>
          <td>
            <UiPill v-if="user.has_pin" tone="good">
              postavljen · {{ user.pin_len }} cifre
            </UiPill>
            <UiPill v-else tone="warn">nije postavljen</UiPill>
          </td>
          <td>
            <span v-if="user.email">{{ user.email }}</span>
            <span v-else class="p-muted">—</span>
          </td>
          <td>
            <UiPill :tone="user.active ? 'good' : 'neutral'">
              {{ user.active ? 'aktivan' : 'ugašen' }}
            </UiPill>
          </td>
          <td class="r">
            <div class="p-actions">
              <UiButton small variant="ghost" @click="open(user)">Izmijeni</UiButton>
              <UiButton small variant="soft" @click="openPin(user)">Novi PIN</UiButton>
            </div>
          </td>
        </tr>
      </UiTable>
    </UiCard>

    <PostavkeUserSheet
      :open="sheetOpen"
      :user="editing"
      :me-id="me.user.value?.id ?? null"
      :pin-len="newUserPinLen"
      :pending="sheetPending"
      :error="sheetError"
      @close="sheetOpen = false"
      @create="create"
      @update="update"
    />

    <PostavkePinSheet
      :pin-len="resetPinLen"
      :open="pinFor !== null"
      :user="pinFor"
      :pending="pinPending"
      :error="pinError"
      :result="pinResult"
      @close="pinFor = null"
      @save="resetPin"
    />
  </PostavkePage>
</template>

<style scoped>
.off td { opacity: 0.6; }
.p-muted { color: var(--muted); }
.p-actions { display: inline-flex; gap: 6px; justify-content: flex-end; }
</style>
