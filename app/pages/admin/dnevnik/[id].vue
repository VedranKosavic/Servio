<script setup lang="ts">
/**
 * One Dnevnik entry, with both ends of a request/decision pair.
 *
 * `GET /api/owner/log/:id` is the only read here, and it is the one place the
 * **other** direction is available: the list attaches `.request` to a decision,
 * and this route also attaches `.resolver` to a request — so a
 * `void_requested` opened from *Puls* shows who decided it and when, without
 * the feed having to carry a second row for every pending thing.
 */
import type { LogEntryDetail } from '#shared/types'
import { bodyFacts, lookOf, splitTitle } from '~/components/dnevnik/dnevnikKinds'

definePageMeta({ middleware: 'admin', layout: 'admin' })

const route = useRoute()
const api = useAdminApi()

const entry = ref<LogEntryDetail | null>(null)
const loading = ref(true)
const error = ref('')

async function load() {
  // Client-only: the session is a httpOnly cookie the browser holds, and a
  // server-rendered `$fetch` would carry none of it and answer 401.
  if (!import.meta.client) return
  loading.value = true
  error.value = ''
  try {
    entry.value = await api.getOwnerLogEntry(String(route.params.id))
  } catch (err) {
    error.value = apiErrorText(err, 'Unos se nije učitao.')
  } finally {
    loading.value = false
  }
}

// The dashboard's one poll: this entry is append-only, but a decision written
// after it was opened turns up as a `log` move and fills in the resolver.
useAdminChanges({ onEntity: entity => { if (entity === 'log') void load() } })

const head = computed(() => entry.value ? splitTitle(entry.value.title_bs).head : 'Dnevnik')
const facts = computed(() => entry.value ? bodyFacts(entry.value.kind, entry.value.body) : [])
const look = computed(() => entry.value ? lookOf(entry.value.kind) : null)

useHead({ title: () => `${head.value} · Dnevnik` })

watch(() => route.params.id, load, { immediate: true })
</script>

<template>
  <div class="a-page">
    <UiPageHead :title="head">
      <template #eyebrow>
        <NuxtLink to="/admin/dnevnik" class="a-back">
          <UiIcon name="chevron-right" :size="16" class="a-back-icon" />
          Dnevnik
        </NuxtLink>
      </template>
      <template v-if="entry" #sub>
        {{ dateBs(entry.business_date) }} · {{ timeBs(entry.at) }}
        <template v-if="entry.actor_name"> · {{ entry.actor_name }}</template>
        <template v-if="entry.device_label"> · {{ entry.device_label }}</template>
      </template>
    </UiPageHead>

    <UiCard v-if="error">
      <p class="a-error">{{ error }}</p>
    </UiCard>

    <UiCard v-else-if="loading">
      <p class="a-skeleton" />
      <p class="a-skeleton" />
    </UiCard>

    <template v-else-if="entry">
      <UiCard>
        <DnevnikEntry :entry="entry" />
      </UiCard>

      <UiCard title="Detalji">
        <UiTable
          :columns="[
            { key: 'what', label: 'Podatak' },
            { key: 'value', label: 'Vrijednost', align: 'r' },
          ]"
        >
          <tr>
            <td>Vrsta</td>
            <td class="r">{{ look?.label }}</td>
          </tr>
          <tr>
            <td>Osoba</td>
            <td class="r">{{ entry.actor_name ?? 'Sistem' }}</td>
          </tr>
          <tr v-if="entry.device_label">
            <td>Uređaj</td>
            <td class="r">{{ entry.device_label }}</td>
          </tr>
          <tr v-for="fact in facts" :key="fact.label">
            <td>{{ fact.label }}</td>
            <td class="r" :class="{ num: fact.numeric }">{{ fact.value }}</td>
          </tr>
        </UiTable>
      </UiCard>

      <UiCard v-if="entry.request" title="Zahtjev koji je ovim riješen">
        <DnevnikEntry :entry="entry.request" linked />
      </UiCard>

      <UiCard v-if="entry.resolver" title="Odluka">
        <DnevnikEntry :entry="entry.resolver" linked />
      </UiCard>

      <div v-if="entry.shift_id" class="a-actions">
        <UiButton variant="ghost" @click="navigateTo(`/admin/smjena/${entry.shift_id}`)">
          Otvori smjenu
        </UiButton>
      </div>
    </template>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }




.a-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--muted);
  font-size: var(--text-micro);
  font-weight: 600;
  text-decoration: none;
  min-height: 24px;
}

/* One chevron in the icon set, pointed the other way for "back". */
.a-back-icon { transform: rotate(180deg); }

.a-error { margin: 0; color: var(--danger); }

.a-skeleton { height: 20px; margin: 0; border-radius: 6px; background: var(--surface-2); }

.a-actions { display: flex; gap: 8px; }

.num { font-variant-numeric: tabular-nums; }

@media (max-width: 1023px) {
  .a-back { min-height: 44px; }
}
</style>
