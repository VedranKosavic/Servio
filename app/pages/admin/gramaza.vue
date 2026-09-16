<script setup lang="ts">
/**
 * *Gramaža* — the two doses a sale takes off *Stanje šanka* (16.09.2026).
 *
 * *Grama po kafi* is what every menu article marked *Troši kafu* deducts from
 * its coffee; *Grama po luli* is one nargila, split across the aromas the
 * waiter chose. Both are venue settings (`grams_per_coffee`,
 * `grams_per_bowl_default`), so the owner changes a dose once for the whole
 * menu. A change moves the next round on: a round already locked has had its
 * grams written, and the ledger is append-only.
 *
 * Admins only — the page is under `/admin`, which no worker reaches.
 */
import type { Settings } from '#shared/settings'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Gramaža' })

const api = useAdminApi()

const settings = ref<Settings | null>(null)
const error = ref('')
const pendingKey = ref<string | null>(null)
const savedKey = ref<string | null>(null)
const fieldError = ref<Record<string, string>>({})

async function load() {
  try {
    settings.value = await api.getSettings()
    error.value = ''
  } catch (err) {
    error.value = apiErrorText(err)
  }
}

onMounted(() => { void load() })

useAdminChanges({
  onEntity: (entity) => { if (entity === 'settings') void load() },
})

type DoseKey = 'grams_per_coffee' | 'grams_per_bowl_default'

const LIMITS: Record<DoseKey, { min: number, max: number }> = {
  grams_per_coffee: { min: 1, max: 50 },
  grams_per_bowl_default: { min: 1, max: 200 },
}

async function commit(key: DoseKey, value: number | null) {
  if (!settings.value) return
  const { min, max } = LIMITS[key]
  if (value === null || value < min || value > max) {
    fieldError.value = { ...fieldError.value, [key]: `Upiši broj od ${min} do ${max}.` }
    return
  }
  fieldError.value = { ...fieldError.value, [key]: '' }
  if (value === settings.value[key]) return

  pendingKey.value = key
  try {
    settings.value = await api.updateSettings({ [key]: value })
    savedKey.value = key
    setTimeout(() => { if (savedKey.value === key) savedKey.value = null }, 2000)
  } catch (err) {
    fieldError.value = { ...fieldError.value, [key]: apiErrorText(err) }
  } finally {
    pendingKey.value = null
  }
}
</script>

<template>
  <div class="a-page">
    <UiPageHead eyebrow="Lokal" title="Gramaža" sub="Koliko jedna prodaja skida sa stanja šanka" :stale="error" />

    <p v-if="!settings && !error" class="g-muted">Učitavanje…</p>

    <template v-if="settings">
      <UiCard title="Kafa">
        <p class="g-note">
          Svaki artikal na meniju označen „Troši kafu“ skida ovoliko grama kafe sa stanja šanka.
        </p>
        <PostavkeNumField
          label="Grama po kafi"
          :model-value="settings.grams_per_coffee"
          kind="decimal"
          suffix="g"
          hint="Npr. 8 — jedna kafa je 8 grama."
          :error="fieldError.grams_per_coffee"
          :pending="pendingKey === 'grams_per_coffee'"
          @commit="value => commit('grams_per_coffee', value)"
        >
          <template #badge>
            <UiPill v-if="savedKey === 'grams_per_coffee'" tone="good">sačuvano</UiPill>
          </template>
        </PostavkeNumField>
      </UiCard>

      <UiCard title="Nargila">
        <p class="g-note">
          Jedna nargila skida ovoliko grama okusa. Kod miješane se dijeli: dva okusa po pola, tri po trećinu.
        </p>
        <PostavkeNumField
          label="Grama po luli"
          :model-value="settings.grams_per_bowl_default"
          kind="decimal"
          suffix="g"
          hint="Npr. 20 — jedna lula je 20 grama."
          :error="fieldError.grams_per_bowl_default"
          :pending="pendingKey === 'grams_per_bowl_default'"
          @commit="value => commit('grams_per_bowl_default', value)"
        >
          <template #badge>
            <UiPill v-if="savedKey === 'grams_per_bowl_default'" tone="good">sačuvano</UiPill>
          </template>
        </PostavkeNumField>
      </UiCard>

      <p class="g-muted">Promjena važi od sljedeće narudžbe; već ukucane ture se ne mijenjaju.</p>
    </template>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.g-note { margin: 0 0 12px; color: var(--ink-2); font-size: var(--text-label); }
.g-muted { margin: 0; color: var(--muted); font-size: var(--text-label); }
</style>
