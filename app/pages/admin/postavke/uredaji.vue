<script setup lang="ts">
/**
 * *Uređaji* — the phones the app runs on.
 *
 * A phone enrols once with a six-character code and keeps a device cookie; a
 * person then PIN-logs in against that device. So this page is where a phone
 * gets into the café and where it is taken back out: *Povuci* kills its cookie,
 * *Otključaj* clears the lock a run of wrong PINs left behind, and *Novi uređaj*
 * mints the code somebody types on the phone itself.
 *
 * A revoked device is never deleted — every round it locked still points at it.
 */
import { useNow } from '@vueuse/core'
import type { DeviceAdmin, EnrolCodeResult, UserAdmin } from '#shared/types'
import type { CreateEnrolCodeBody } from '#shared/schemas'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Uređaji' })

const api = useAdminApi()
const me = useMe()

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

async function act(device: DeviceAdmin, run: () => Promise<unknown>, fallback: string) {
  busyId.value = device.id
  try {
    await run()
    error.value = null
    await load()
  } catch (err) {
    await load()
    error.value = apiErrorText(err, fallback)
  } finally {
    busyId.value = null
  }
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
      <UiButton
        variant="primary"
        @click="enrolError = null; enrolResult = null; enrolOpen = true"
      >Novi uređaj</UiButton>
    </template>

    <UiCard title="Uređaji" :count="devices.length">
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
          @unlock="act(device, () => api.unlockDevice(device.id), 'Uređaj nije otključan.')"
          @revoke="act(device, () => api.revokeDevice(device.id), 'Uređaj nije povučen.')"
        />
      </UiTable>
    </UiCard>

    <PostavkeEnrolSheet
      :open="enrolOpen"
      :users="users"
      :pending="enrolPending"
      :error="enrolError"
      :result="enrolResult"
      @close="enrolOpen = false"
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
