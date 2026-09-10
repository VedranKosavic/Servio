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
import type { PinResetResult, Role, UserAdmin } from '#shared/types'
import type { CreateUserBody, UpdateUserBody } from '#shared/schemas'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Osoblje' })

const api = useAdminApi()
const me = useMe()

const ROLE_LABELS: Record<Role, string> = {
  waiter: 'Konobar',
  bartender: 'Šanker',
  admin: 'Vlasnik',
}

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
      :pending="sheetPending"
      :error="sheetError"
      @close="sheetOpen = false"
      @create="create"
      @update="update"
    />

    <PostavkePinSheet
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
