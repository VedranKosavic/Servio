<script setup lang="ts">
/**
 * *Podešavanja* — the landing screen of *Meni i postavke*, and the numbers the
 * whole café is judged against.
 *
 * Nothing here is a deploy: `venues.settings_json` holds only the keys the owner
 * has actually touched, and every read spreads it over the documented defaults,
 * so a key nobody has ever set behaves as its default rather than as nothing.
 *
 * Each field posts its own `PATCH` the moment it is left, and the answer is the
 * whole merged `Settings` — so the screen shows what the server stored, never
 * what was typed. `useMe().load()` follows, because the same settings ride along
 * in the session envelope every other screen reads its thresholds from.
 *
 * **No Pravila editor here.** The published thresholds page and the
 * acknowledgements are Phase 4; this screen is the numbers alone.
 */
import type { Settings, SettingsPatch } from '#shared/settings'
import type { Role } from '#shared/types'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Podešavanja' })

const api = useAdminApi()
const me = useMe()

const settings = ref<Settings | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

const savedKey = ref<string | null>(null)
const pendingKey = ref<string | null>(null)
const fieldError = ref<{ key: string, text: string } | null>(null)

let savedTimer: ReturnType<typeof setTimeout> | null = null

async function load() {
  try {
    settings.value = await api.getSettings()
    error.value = null
  } catch (err) {
    error.value = apiErrorText(err, 'Podešavanja se nisu učitala.')
  } finally {
    loading.value = false
  }
}

onMounted(() => { void load() })

useAdminChanges({
  onEntity: (entity) => { if (entity === 'settings') void load() },
})

onBeforeUnmount(() => { if (savedTimer) clearTimeout(savedTimer) })

async function save(key: keyof Settings, value: number | Role[]) {
  if (!settings.value) return
  if (settings.value[key] === value) return

  pendingKey.value = key
  fieldError.value = null
  try {
    settings.value = await api.updateSettings({ [key]: value } as SettingsPatch)
    // The same thresholds ride in the session envelope every other screen reads,
    // so refresh it rather than letting two copies disagree until the next poll.
    await me.load()

    savedKey.value = key
    if (savedTimer) clearTimeout(savedTimer)
    savedTimer = setTimeout(() => { savedKey.value = null }, 2000)
  } catch (err) {
    // Re-read first — `load()` clears `error`, and the refused value has to go
    // back to what the server actually holds before the sentence is shown.
    await load()
    fieldError.value = { key, text: apiErrorText(err, 'Nije snimljeno.') }
  } finally {
    pendingKey.value = null
  }
}
</script>

<template>
  <PostavkePage
    title="Podešavanja"
    sub="Pragovi po kojima lokal radi"
    :error="error"
  >
    <UiCard v-if="loading" title="Podešavanja">
      <p class="p-skeleton" />
      <p class="p-skeleton" />
      <p class="p-skeleton" />
    </UiCard>

    <PostavkeSettingsForm
      v-else-if="settings"
      :settings="settings"
      :saved-key="savedKey"
      :pending-key="pendingKey"
      :field-error="fieldError"
      @save="save"
    />

    <p class="p-foot">
      Svaka izmjena ide u Dnevnik sa starom i novom vrijednošću.
    </p>
  </PostavkePage>
</template>

<style scoped>
.p-skeleton {
  margin: 0;
  height: 12px;
  border-radius: 6px;
  background: var(--surface-2);
}

.p-foot { margin: 0; color: var(--muted); font-size: 13px; }
</style>
