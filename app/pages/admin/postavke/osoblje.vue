<script setup lang="ts">
/**
 * *Osoblje* — who works here, what they may do, and who can log in.
 *
 * Nobody is ever deleted: a waiter who left in March is still the actor on every
 * round he locked, and a foreign key that stops resolving is a shift report that
 * silently loses a person. So the way out is *Aktivan* off — and an admin cannot
 * do that to himself, because he would be locking the only door into `/admin`.
 *
 * **No response here carries a hash and no screen shows one.** The PIN mark says
 * whether one exists, and nothing else.
 *
 * **The screen is the staff, not the table.** `GET /api/admin/users` answers with
 * everybody the café has ever had — fifteen people in the owner's database, of
 * whom seven work here — so drawing the response was drawing two people called
 * *Emir* and a *Haris* nobody remembers hiring. The active staff is the screen;
 * the retired ones are behind one fold that says how many it is holding, at both
 * widths, because reactivating somebody is a real thing the owner does.
 *
 * **Two layouts, one page.** At a desk this is a table and it should be: six
 * columns of fifteen people, compared at a glance. In a hand it was a 390 px box
 * dragged sideways past *Inicijali* — a derived two-letter string that never
 * deserved a column anywhere, and is now the circle on the left of every row.
 * Below 1024 px the table is gone and the staff is a list (`PostavkeOsobljeList`):
 * the name doing the talking, the role and the PIN state as marks under it, and
 * every action behind the row in `PostavkeOsobljeSheet`. Nothing on this screen
 * scrolls sideways at any width.
 *
 * **`useMounted` is not optional there.** `useMediaQuery` answers truthfully from
 * the first client render and the server — which has no viewport — always says
 * the laptop. Without the gate the two renders disagree about the whole page and
 * Vue throws the server's markup away with a hydration mismatch. So the first
 * paint is the table at both widths and the phone swaps to the list on mount,
 * which happens before the first read lands.
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

/** The dashboard's own breakpoint — the width `admin.css` changes density at. */
const mounted = useMounted()
const narrow = useMediaQuery('(max-width: 1023px)')
const isPhone = computed(() => mounted.value && narrow.value)

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
 * The person whose row sheet is open on a phone, **by id and not by object**: a
 * write replaces the row in `users`, and a sheet holding the old object would go
 * on saying *bez PIN-a* after the server answered.
 */
const rowId = ref<string | null>(null)
const rowPending = ref(false)
const rowError = ref<string | null>(null)

const rowUser = computed(() => users.value.find(user => user.id === rowId.value) ?? null)

const meId = computed(() => me.user.value?.id ?? null)

const team = computed(() => users.value.filter(user => user.active))
const retired = computed(() => users.value.filter(user => !user.active))

/** The laptop's fold: the table shows the staff until the owner asks for all. */
const show = ref<'aktivni' | 'svi'>('aktivni')
const rows = computed(() => (show.value === 'svi' ? users.value : team.value))

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
  { key: 'uloga', label: 'Uloga', width: '120px' },
  { key: 'pin', label: 'PIN', width: '150px' },
  { key: 'email', label: 'E-mail' },
  { key: 'stanje', label: 'Stanje', width: '110px' },
  { key: 'akcije', label: '', align: 'r' as const, width: '200px' },
]

/** Stored, but a row still has to draw a circle for a person who has none. */
function initialsOf(user: UserAdmin) {
  return user.initials || user.name.slice(0, 2).toUpperCase()
}

function open(user: UserAdmin | null) {
  rowId.value = null
  editing.value = user
  sheetError.value = null
  sheetOpen.value = true
}

function openPin(user: UserAdmin) {
  rowId.value = null
  pinFor.value = user
  pinError.value = null
  pinResult.value = null
}

function openRow(user: UserAdmin) {
  rowError.value = null
  rowId.value = user.id
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

/**
 * The one-tap way off the staff and back onto it, from the row sheet.
 *
 * The same `PATCH` the edit sheet sends, so the server's own guards still hold —
 * an admin deactivating himself is a 400 `SELF_DEACTIVATE`, and a returning
 * person comes back with his stored PIN dropped.
 */
async function setActive(active: boolean) {
  const user = rowUser.value
  if (!user) return
  rowPending.value = true
  try {
    await api.updateUser(user.id, { active })
    rowError.value = null
    rowId.value = null
    await load()
  } catch (err) {
    rowError.value = apiErrorText(
      err, active ? 'Radnik nije vraćen.' : 'Radnik nije ugašen.',
    )
  } finally {
    rowPending.value = false
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

    <!-- ---- the phone ------------------------------------------------- -->
    <PostavkeOsobljeList
      v-if="isPhone"
      :team="team"
      :retired="retired"
      :loading="loading"
      :me-id="meId"
      @open="openRow"
    />

    <!-- ---- the laptop ------------------------------------------------ -->
    <template v-else>
      <div class="p-filters">
        <UiSeg
          :model-value="show"
          label="Koje osoblje"
          :options="[{ value: 'aktivni', label: 'Aktivni' }, { value: 'svi', label: 'Svi' }]"
          @update:model-value="value => show = value as 'aktivni' | 'svi'"
        />
        <span v-if="retired.length" class="p-off-count">
          Ugašeni · <span class="num">{{ retired.length }}</span>
        </span>
      </div>

      <UiCard title="Osoblje" :count="rows.length">
        <UiTable :columns="columns" :loading="loading" empty="Nema radnika.">
          <tr v-for="user in rows" :key="user.id" :class="{ off: !user.active }">
            <td>
              <span class="p-who">
                <span
                  class="avatar avatar-sm"
                  :class="{ 'avatar-accent': user.id === meId }"
                  aria-hidden="true"
                >{{ initialsOf(user) }}</span>
                <strong>{{ user.name }}</strong>
              </span>
            </td>
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
    </template>

    <!-- Mounted before the two sheets it hands over to: both lock the page
         behind them, and when this one closes to hand over, the other's lock
         has to be the one that wins. -->
    <PostavkeOsobljeSheet
      :open="rowUser !== null"
      :user="rowUser"
      :is-me="rowUser !== null && rowUser.id === meId"
      :pending="rowPending"
      :error="rowError"
      @close="rowId = null"
      @pin="rowUser && openPin(rowUser)"
      @edit="rowUser && open(rowUser)"
      @set-active="setActive"
    />

    <PostavkeUserSheet
      :open="sheetOpen"
      :user="editing"
      :me-id="meId"
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

.p-filters { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }

.p-off-count {
  font-size: var(--text-micro);
  color: var(--muted);
  margin-left: auto;
}

/* The circle carries the initials the table used to spend a column on. */
.p-who { display: inline-flex; align-items: center; gap: 10px; min-width: 0; }
</style>
