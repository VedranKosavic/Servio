<script setup lang="ts">
/**
 * *Pravila* on `/admin` — writing the house rules, publishing a version, and seeing
 * who has read it.
 *
 * **Append-only, by the database.** `rules_no_update` and `rules_no_delete`
 * refuse an edit, so *Objavi novu verziju* is the only write there is and a
 * correction is v4 standing beside v3. That is what makes "what did the rules
 * say when Amar confirmed them?" a row rather than a guess — and it is why the
 * confirm sheet names the version out loud before it posts.
 *
 * **The acknowledgement list is the one per-person list in this app that is not
 * surveillance** (PHASE4 §3, WP4). It says one thing — that the rules were
 * read — and PLAN §8 forbids every other per-person list precisely so this one
 * can exist honestly.
 *
 * The `{{cash_tolerance_fen}}` tokens in the text are filled from the venue's
 * live settings when a phone renders them, so the preview here shows exactly
 * what the staff will see today, and a threshold changed tomorrow changes on
 * every phone with no new version.
 */
import type { RuleVersion, RulesView } from '#shared/types'
import type { Settings } from '#shared/settings'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Pravila' })

const api = useAdminApi()
const me = useMe()

const versions = ref<RuleVersion[]>([])
const mine = ref<RulesView | null>(null)
const settings = computed<Settings | null>(() => me.settings.value)

const loading = ref(true)
const error = ref<string | null>(null)
const publishing = ref(false)
const acking = ref(false)
const askPublish = ref(false)
const openVersion = ref<string | null>(null)

const draft = ref('')
// `string`, not a union: `UiSeg` speaks plain strings, and a narrower ref
// would not type-check against its `v-model`.
const mode = ref('edit')

const current = computed(() => versions.value[0] ?? null)
const nextVersion = computed(() => (current.value?.version ?? 0) + 1)
const preview = computed(() => renderRules(draft.value, settings.value))

/** Below `min(20)` the server refuses the body, and so does the button. */
const canPublish = computed(() =>
  draft.value.trim().length >= 20 && draft.value.trim() !== (current.value?.body_md.trim() ?? ''))

const acks = computed(() => current.value?.acks ?? [])
const ackedCount = computed(() => acks.value.filter(a => a.at).length)

async function load(keepDraft = false) {
  try {
    const [list, own] = await Promise.all([api.getRuleVersions(), api.getRules()])
    versions.value = list
    mine.value = own
    error.value = null
    // The editor opens on what is published, or on a starter draft for a venue
    // that has never published anything — a blank textarea is the worst way to
    // ask somebody to write down how his café works.
    if (!keepDraft) draft.value = list[0]?.body_md ?? RULES_DRAFT_MD
  } catch (err) {
    error.value = apiErrorText(err, 'Pravila se nisu učitala.')
  } finally {
    loading.value = false
  }
}

onMounted(() => { void load() })

useAdminChanges({
  onEntity: (entity) => { if (entity === 'rules') void load(true) },
})

async function publish() {
  publishing.value = true
  try {
    await api.publishRules({ body_md: draft.value.trim() })
    askPublish.value = false
    await load()
  } catch (err) {
    askPublish.value = false
    error.value = apiErrorText(err, 'Objava nije prošla.')
  } finally {
    publishing.value = false
  }
}

/**
 * The owner confirms his own rules like everybody else.
 *
 * `POST /api/me/rules/ack` is the same route the phones call — it is `useApi`'s
 * and not `useAdminApi`'s because it is about the person, not the dashboard.
 * Without this the list would show the author of the rules as the one person
 * who never read them.
 */
async function ackOwn() {
  const version = mine.value?.version
  if (!version) return
  acking.value = true
  try {
    mine.value = await useApi().ackRules(version)
    await load(true)
  } catch (err) {
    error.value = apiErrorText(err, 'Potvrda nije snimljena.')
  } finally {
    acking.value = false
  }
}

/** Put an old version back in the editor, as the starting point for a new one. */
function reuse(version: RuleVersion) {
  draft.value = version.body_md
  mode.value = 'edit'
}

function insertToken(key: string) {
  draft.value = `${draft.value.replace(/\s*$/, '')}\n{{${key}}}`
  mode.value = 'edit'
}
</script>

<template>
  <PostavkePage
    title="Pravila"
    sub="Objavljeni tekst, verzije i potvrde"
    :error="error"
  >
    <template #actions>
      <UiPill v-if="current" tone="neutral">Objavljeno v{{ current.version }}</UiPill>
      <UiPill v-else tone="warn">Nije objavljeno</UiPill>
      <UiButton variant="primary" :disabled="!canPublish" @click="askPublish = true">
        Objavi novu verziju
      </UiButton>
    </template>

    <UiCard v-if="loading" title="Tekst">
      <p class="p-skel" />
      <p class="p-skel" />
      <p class="p-skel" />
    </UiCard>

    <template v-else>
      <UiCard title="Tekst">
        <template #actions>
          <UiSeg
            v-model="mode"
            label="Uređivanje ili pregled"
            :options="[{ value: 'edit', label: 'Uređivanje' }, { value: 'preview', label: 'Pregled' }]"
          />
        </template>

        <textarea
          v-if="mode === 'edit'"
          v-model="draft"
          class="p-editor"
          aria-label="Tekst Pravila"
          spellcheck="false"
        />

        <div v-else class="p-preview">
          <PravilaDoc :blocks="preview" />
        </div>

        <p class="p-hint">
          Naslov je red koji počinje sa <code>#</code>, stavka liste sa
          <code>-</code>, podebljano ide među <code>**</code>. Ništa drugo se ne
          formatira i nikakav kod se ne izvršava.
        </p>

        <div class="p-tokens">
          <span class="p-tokens-label">Pragovi — ubaci u tekst:</span>
          <button
            v-for="token in RULE_TOKENS"
            :key="token.key"
            type="button"
            class="p-token"
            :title="token.label"
            @click="insertToken(token.key)"
          >
            {{ token.label }}
            <span class="p-token-value">{{ settings ? formatSetting(token.key, settings) : '' }}</span>
          </button>
        </div>

        <p class="p-hint">
          Broj iz pragova se upisuje pri čitanju, na svakom telefonu. Kad
          promijeniš prag u Podešavanjima, Pravila se mijenjaju s njim — bez nove
          verzije.
        </p>
      </UiCard>

      <UiCard
        v-if="current"
        :title="`Potvrde · v${current.version}`"
        :count="`${ackedCount} / ${acks.length}`"
      >
        <template v-if="mine?.must_ack" #actions>
          <UiButton variant="primary" :pending="acking" @click="ackOwn">
            Potvrđujem
          </UiButton>
        </template>

        <UiTable
          :columns="[
            { key: 'ime', label: 'Ime' },
            { key: 'stanje', label: 'Stanje' },
            { key: 'kad', label: 'Potvrđeno', align: 'r' },
          ]"
          empty="Nema aktivnih ljudi."
        >
          <tr v-for="ack in acks" :key="ack.user_id">
            <td>{{ ack.user_name }}</td>
            <td>
              <!-- Neuter, not "potvrdio": half the staff is female and a pill
                   cannot know which. It is the *Pravila* that are confirmed. -->
              <UiPill v-if="ack.at" tone="good">potvrđeno</UiPill>
              <UiPill v-else tone="warn">nije potvrđeno</UiPill>
            </td>
            <td class="r">{{ ack.at ? dateTimeBs(ack.at) : '—' }}</td>
          </tr>
        </UiTable>

        <p class="p-foot">
          Ovdje se vidi samo da su Pravila pročitana i kada. Ništa drugo o
          čitanju se nigdje ne bilježi.
        </p>
      </UiCard>

      <UiCard title="Verzije" :count="versions.length">
        <p v-if="versions.length === 0" class="p-foot">
          Još nijedna verzija nije objavljena. Napiši tekst gore i objavi ga.
        </p>

        <div v-for="version in versions" :key="version.id" class="p-version">
          <div class="p-version-head">
            <span class="p-version-no">v{{ version.version }}</span>
            <span class="p-version-meta">
              {{ dateTimeBs(version.published_at) }} · {{ version.published_by_name }}
            </span>
            <div class="p-version-actions">
              <UiButton
                small
                @click="openVersion = openVersion === version.id ? null : version.id"
              >
                {{ openVersion === version.id ? 'Sakrij' : 'Pogledaj' }}
              </UiButton>
              <UiButton small @click="reuse(version)">Prepiši u uređivanje</UiButton>
            </div>
          </div>

          <div v-if="openVersion === version.id" class="p-preview">
            <PravilaDoc :blocks="renderRules(version.body_md, settings)" />
          </div>
        </div>
      </UiCard>
    </template>

    <UiSheet
      :open="askPublish"
      :title="`Objaviti Pravila v${nextVersion}?`"
      action="Objavi"
      :pending="publishing"
      @close="askPublish = false"
      @confirm="publish"
    >
      <p class="p-sheet">
        Tekst postaje verzija <strong>v{{ nextVersion }}</strong> i ostaje takav
        — ispravka je nova verzija, pored ove.
      </p>
      <p class="p-sheet">
        Svako od osoblja je potvrđuje jednom, pri sljedećoj prijavi. U kanalu
        Svi se pojavljuje jedan red da su Pravila objavljena.
      </p>
    </UiSheet>
  </PostavkePage>
</template>

<style scoped>
.p-skel {
  margin: 0;
  height: 12px;
  border-radius: 6px;
  background: var(--surface-2);
}

.p-editor {
  width: 100%;
  min-height: 320px;
  resize: vertical;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--field-bg);
  color: var(--ink);
  padding: 12px;
  font: inherit;
  font-size: var(--text-label);
  line-height: 1.5;
}

.p-editor:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.p-preview {
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface-2);
  padding: 14px;
  color: var(--ink);
  font-size: var(--text-label);
  line-height: 1.5;
}

.p-hint { margin: 0; color: var(--muted); font-size: var(--text-micro); }
.p-hint code { font-size: var(--text-micro); }
.p-foot { margin: 0; color: var(--muted); font-size: var(--text-micro); }

.p-tokens { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.p-tokens-label { color: var(--muted); font-size: var(--text-micro); }

.p-token {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink-2);
  font: inherit;
  font-size: var(--text-micro);
  cursor: pointer;
}

.p-token-value {
  color: var(--accent-ink);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.p-version {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 0;
  border-top: 1px solid var(--surface-2);
}

.p-version:first-of-type { border-top: 0; padding-top: 0; }

.p-version-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.p-version-no { font-weight: 700; font-variant-numeric: tabular-nums; }
.p-version-meta { color: var(--muted); font-size: var(--text-micro); }
.p-version-actions { margin-left: auto; display: flex; gap: 6px; }

.p-sheet { margin: 0; font-size: var(--text-label); color: var(--ink-2); }

@media (max-width: 1023px) {
  .p-token { height: 44px; }
  .p-version-actions { margin-left: 0; width: 100%; }
}
</style>
