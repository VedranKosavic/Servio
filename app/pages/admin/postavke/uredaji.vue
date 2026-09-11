<script setup lang="ts">
/**
 * *Uređaji* — the phones the app runs on.
 *
 * A phone enrols once with a six-character code and keeps a device cookie; a
 * person then PIN-logs in against that device. So this page is where a phone
 * gets into the café and where it is taken back out: *Povuci* kills its cookie,
 * *Otključaj* clears every lockout a run of wrong PINs left behind — the flagged
 * one at fifteen failures *and* the counted ones at five and ten, which is why
 * it is offered on a phone the table calls *aktivan* — and *Novi uređaj* mints
 * the code somebody types on the phone itself.
 *
 * A revoked device is never deleted — every round it locked still points at it.
 *
 * **Two layouts, one page.** At a desk this is an eight-column table and it
 * should be: the whole fleet's outbox depth and clock skew compared at a glance.
 * In a hand it is a list (`PostavkeUredList`): the phone's name, who has it and
 * a mark for anything wrong with it, with the diagnostics and all three actions
 * behind the chevron in `PostavkeUredSheet`. Revoked phones fold away under the
 * live ones instead of burying them.
 *
 * **`useMounted` is not optional.** `useMediaQuery` answers truthfully from the
 * first client render and the server — which has no viewport — always says the
 * laptop, so without the gate the two renders disagree and Vue throws the
 * server's markup away with a hydration mismatch.
 *
 * **The enrolment code is a credential.** It is never logged, never written to
 * storage and never sent anywhere; the server keeps only a hash, and this page
 * drops its copy the moment the sheet closes.
 */
import { useNow } from '@vueuse/core'
import type { DeviceAdmin, EnrolCodeResult, UserAdmin } from '#shared/types'
import type { CreateEnrolCodeBody } from '#shared/schemas'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Uređaji' })

const api = useAdminApi()
const me = useMe()

/** The dashboard's own breakpoint — the width `admin.css` changes density at. */
const mounted = useMounted()
const narrow = useMediaQuery('(max-width: 1023px)')
const isPhone = computed(() => mounted.value && narrow.value)

const devices = ref<DeviceAdmin[]>([])
const users = ref<UserAdmin[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const busyId = ref<string | null>(null)

const enrolOpen = ref(false)
const enrolPending = ref(false)
const enrolError = ref<string | null>(null)
const enrolResult = ref<EnrolCodeResult | null>(null)

const renameFor = ref<DeviceAdmin | null>(null)
const renamePending = ref(false)
const renameError = ref<string | null>(null)

/**
 * The device whose sheet is open on a phone, **by id and not by object**: an
 * unlock replaces the row in `devices`, and a sheet holding the old object would
 * go on drawing the *zaključan* pill after the server answered.
 */
const sheetId = ref<string | null>(null)

/**
 * A clock for rendering only — "javio se prije 4 min" has to age between polls.
 * The data still refreshes on the one 15 s poll and on nothing else.
 */
const now = useNow({ interval: 30_000 })
const nowMs = computed(() => now.value.getTime())

async function load() {
  try {
    const [list, staff] = await Promise.all([api.getDevices(), api.getUsers()])
    devices.value = list
    users.value = staff
    error.value = null
  } catch (err) {
    error.value = apiErrorText(err, 'Uređaji se nisu učitali.')
  } finally {
    loading.value = false
  }
}

onMounted(() => { void load() })

useAdminChanges({
  onEntity: (entity) => { if (entity === 'device' || entity === 'user') void load() },
})

/** The thresholds this page judges a phone against live in *Podešavanja*. */
const freshS = computed(() => me.settings.value?.heartbeat_fresh_s ?? 600)
const skewAlertS = computed(() => me.settings.value?.clock_skew_alert_s ?? 300)

/** The sheet's device, read fresh every render. Null closes the sheet. */
const sheetDevice = computed(() =>
  devices.value.find(device => device.id === sheetId.value) ?? null)

const columns = [
  { key: 'uredaj', label: 'Uređaj' },
  { key: 'osoba', label: 'Čiji je', width: '130px' },
  { key: 'stanje', label: 'Stanje', width: '110px' },
  { key: 'neposlano', label: 'Neposlano', align: 'r' as const, width: '130px' },
  { key: 'javio', label: 'Javio se', width: '160px' },
  { key: 'sat', label: 'Sat', align: 'r' as const, width: '100px' },
  { key: 'verzija', label: 'Verzija', width: '100px' },
  { key: 'akcije', label: '', align: 'r' as const, width: '230px' },
]

/** `true` when the write landed — the sheet closes on a revoke that worked. */
async function act(
  device: DeviceAdmin, run: () => Promise<unknown>, fallback: string,
): Promise<boolean> {
  busyId.value = device.id
  try {
    await run()
    error.value = null
    await load()
    return true
  } catch (err) {
    await load()
    error.value = apiErrorText(err, fallback)
    return false
  } finally {
    busyId.value = null
  }
}

function unlock(device: DeviceAdmin) {
  return act(device, () => api.unlockDevice(device.id), 'Uređaj nije otključan.')
}

async function revoke(device: DeviceAdmin, closeSheet: boolean) {
  const done = await act(device, () => api.revokeDevice(device.id), 'Uređaj nije povučen.')
  if (done && closeSheet) sheetId.value = null
}

/**
 * The device sheet hands over to the rename sheet rather than stacking on top of
 * it: two scrims on a phone is one scrim too many.
 */
function openRename(device: DeviceAdmin) {
  sheetId.value = null
  renameError.value = null
  renameFor.value = device
}

function openEnrol() {
  enrolError.value = null
  enrolResult.value = null
  enrolOpen.value = true
}

/** The code is a credential: the page's copy of it dies with the sheet. */
function closeEnrol() {
  enrolOpen.value = false
  enrolResult.value = null
}

async function createCode(body: CreateEnrolCodeBody) {
  enrolPending.value = true
  try {
    enrolResult.value = await api.createEnrolCode(body)
    enrolError.value = null
  } catch (err) {
    enrolError.value = apiErrorText(err, 'Kod nije napravljen.')
  } finally {
    enrolPending.value = false
  }
}

async function rename(label: string) {
  const device = renameFor.value
  if (!device) return
  renamePending.value = true
  try {
    await api.updateDevice(device.id, { label })
    renameFor.value = null
    await load()
  } catch (err) {
    renameError.value = apiErrorText(err, 'Naziv nije snimljen.')
  } finally {
    renamePending.value = false
  }
}
</script>

<template>
  <PostavkePage
    title="Uređaji"
    sub="Telefoni koji smiju raditi u lokalu"
    :error="error"
  >
    <template #actions>
      <UiButton variant="primary" @click="openEnrol">Novi uređaj</UiButton>
    </template>

    <!-- ---- the phone --------------------------------------------------- -->
    <PostavkeUredList
      v-if="isPhone"
      :devices="devices"
      :loading="loading"
      :fresh-s="freshS"
      :skew-alert-s="skewAlertS"
      :now="nowMs"
      @open="device => sheetId = device.id"
    />

    <!-- ---- the laptop -------------------------------------------------- -->
    <UiCard v-else title="Uređaji" :count="devices.length">
      <UiTable :columns="columns" :loading="loading" empty="Nijedan uređaj još nije prijavljen.">
        <PostavkeDeviceRow
          v-for="device in devices"
          :key="device.id"
          :device="device"
          :fresh-s="freshS"
          :skew-alert-s="skewAlertS"
          :pending="busyId === device.id"
          :now="nowMs"
          @rename="renameError = null; renameFor = device"
          @unlock="unlock(device)"
          @revoke="revoke(device, false)"
        />
      </UiTable>
    </UiCard>

    <!-- Mounted before the rename sheet on purpose: both lock the page behind
         them, and when this one closes to hand over, the rename sheet's lock
         has to be the one that wins. -->
    <PostavkeUredSheet
      :open="sheetDevice !== null"
      :device="sheetDevice"
      :fresh-s="freshS"
      :skew-alert-s="skewAlertS"
      :now="nowMs"
      :pending="busyId !== null && busyId === sheetId"
      @close="sheetId = null"
      @rename="sheetDevice && openRename(sheetDevice)"
      @unlock="sheetDevice && unlock(sheetDevice)"
      @revoke="sheetDevice && revoke(sheetDevice, true)"
    />

    <PostavkeEnrolSheet
      :open="enrolOpen"
      :users="users"
      :pending="enrolPending"
      :error="enrolError"
      :result="enrolResult"
      @close="closeEnrol"
      @save="createCode"
    />

    <PostavkeRenameSheet
      :open="renameFor !== null"
      :device="renameFor"
      :pending="renamePending"
      :error="renameError"
      @close="renameFor = null"
      @save="rename"
    />
  </PostavkePage>
</template>
