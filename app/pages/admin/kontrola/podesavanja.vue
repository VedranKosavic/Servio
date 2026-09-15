<script setup lang="ts">
/**
 * `/admin/kontrola/podesavanja` — *Podešavanja*: the thresholds the café is
 * measured against, and who may decide somebody else's money.
 *
 * **Each field saves by itself, on blur.** The owner comes here to change one
 * number; a form that must be submitted is a form left half-typed. The answer to
 * `PATCH /api/admin/settings` is the whole merged `Settings`, so the screen shows
 * what the server stored, never what was typed. `useMe().load()` follows,
 * because the same settings ride in the session envelope other screens read.
 *
 * **Only settings the server actually reads are here.** `settingsSchema` accepts
 * a few keys nothing consumes yet (`cash_custody`, `comp_shift_fen`, …); a field
 * that changes nothing would be a lie on the screen. Structural keys (time zone,
 * business-day start, payment methods) are left out too: changing them moves
 * business dates and the cash flow, which is a decision, not a threshold.
 *
 * **PLAN §8.** A threshold never accuses: crossing one is "označeno za
 * razgovor". The fields staff see on *Pravila* say so under themselves, in the
 * words *Pravila* uses (`formatSetting`), so the owner reads the published
 * sentence while he edits the number behind it.
 *
 * **Who approves** is a list of roles, and the server refuses an empty one
 * (`.min(1)`); the screen refuses to send it in the first place, because an empty
 * list would leave nobody able to decide a storno.
 */
import { SETTINGS_LABELS, settingsSchema, type Settings, type SettingsPatch } from '#shared/settings'
import { ROLE_LABELS } from '#shared/landing'
import type { Role } from '#shared/types'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Podešavanja' })

const api = useAdminApi()
const me = useMe()

type NumKind = 'money' | 'pct' | 's' | 'min' | 'count' | 'g'

interface NumFieldDef { key: keyof Settings, kind: NumKind, hint: string }
interface Group { id: string, title: string, note: string, fields: NumFieldDef[] }

const SUFFIX: Record<NumKind, string> = { money: 'KM', pct: '%', s: 's', min: 'min', count: 'kom', g: 'g' }
const INPUT_KIND: Record<NumKind, 'money' | 'decimal' | 'int'> = {
  money: 'money', pct: 'decimal', s: 'int', min: 'int', count: 'int', g: 'decimal',
}

const GROUPS: Group[] = [
  {
    id: 'pazar',
    title: 'Pazar',
    note: 'Koliko predaja smije odstupati od očekivanog prije nego se označi za razgovor.',
    fields: [
      { key: 'cash_tolerance_fen', kind: 'money', hint: 'Razlika do ovog iznosa je u toleranciji.' },
      { key: 'cash_tolerance_pct', kind: 'pct', hint: 'Ili ovaj dio očekivanog iznosa — vrijedi veće od ova dva.' },
      { key: 'variance_alert_fen', kind: 'money', hint: 'Manjak robe na popisu iznad ovoga ide u obavijesti.' },
    ],
  },
  {
    id: 'zakljucenje',
    title: 'Zaključenje smjene',
    note: 'Šta šanker oduzima od prihoda kad zaključi smjenu.',
    fields: [
      { key: 'dnevnica_fen', kind: 'money', hint: 'Oduzima se jednom po smjeni pri zaključenju.' },
    ],
  },
  {
    id: 'storno',
    title: 'Storno',
    note: 'Šta radnik smije poništiti sam, i do kada o stornu odlučuje šanker.',
    fields: [
      { key: 'void_self_window_s', kind: 's', hint: 'Koliko dugo poslije zaključavanja radnik sam poništava svoju turu.' },
      { key: 'self_void_max_per_shift', kind: 'count', hint: 'Vlastitih storna u jednoj smjeni.' },
      { key: 'self_void_max_fen', kind: 'money', hint: 'Najveći iznos stavke koju poništava sam.' },
      { key: 'bartender_approve_window_s', kind: 's', hint: 'Poslije ovoga o stornu odlučuje vlasnik.' },
    ],
  },
  {
    id: 'gratis',
    title: 'Na račun kuće',
    note: 'Piće za osoblje i gratis gostima.',
    fields: [
      { key: 'staff_drinks_per_shift', kind: 'count', hint: 'Pića za osoblje u jednoj smjeni.' },
      { key: 'staff_drink_max_fen', kind: 'money', hint: 'Najskuplje piće koje ide kao piće za osoblje.' },
      { key: 'comp_large_fen', kind: 'money', hint: 'Gratis od ovog iznosa naviše ide u obavijesti.' },
    ],
  },
  {
    id: 'otpis',
    title: 'Otpis',
    note: 'Kad otpis traži PIN nekoga ko odobrava.',
    fields: [
      { key: 'waste_pin_threshold_fen', kind: 'money', hint: 'Otpis iznad ovoga potvrđuje neko ko odobrava.' },
      { key: 'waste_events_per_shift_per_user', kind: 'count', hint: 'Otpisa po osobi u jednoj smjeni.' },
    ],
  },
  {
    id: 'nargila',
    title: 'Nargila',
    note: 'Očekivana potrošnja duhana po luli.',
    fields: [
      { key: 'grams_per_bowl_default', kind: 'g', hint: 'Grama duhana po luli kad artikal nema svoju normu.' },
      { key: 'gpb_band_pct', kind: 'pct', hint: 'Koliko smije odstupati prije nego se označi.' },
    ],
  },
  {
    id: 'uredaji',
    title: 'Raspored i uređaji',
    note: 'Kašnjenje, zajednički tablet i telefoni koji se ne javljaju.',
    fields: [
      { key: 'roster_late_grace_min', kind: 'min', hint: 'Prva akcija poslije ovoga se ispiše u Satima — podatak, ne oznaka.' },
      { key: 'shared_device_idle_s', kind: 's', hint: 'Zajednički tablet se sam zaključa bez dodira.' },
      { key: 'heartbeat_fresh_s', kind: 's', hint: 'Telefon koji se ne javi duže od ovoga smatra se tihim.' },
      { key: 'clock_skew_alert_s', kind: 's', hint: 'Sat telefona koji odstupa više od ovoga ide u obavijesti.' },
    ],
  },
]

/** The two role lists, each gating money that is not the decider's own. */
const ROLE_SETTINGS: { key: 'approver_roles' | 'payout_approver_roles', hint: string }[] = [
  { key: 'approver_roles', hint: 'Odlučuje o stornu, otpisu i predaji pazara kolege.' },
  { key: 'payout_approver_roles', hint: 'Odobrava isplatu iz kase.' },
]
const ROLES: Role[] = ['admin', 'radnik']

/** The keys *Pravila* prints to staff — `RULE_TOKENS`, auto-imported. */
const published = new Set(RULE_TOKENS.map(token => token.key))

const settings = ref<Settings | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

const savedKey = ref<string | null>(null)
const pendingKey = ref<string | null>(null)
const fieldError = ref<{ key: string, text: string } | null>(null)
/** Bumped to remount the number fields after an emptied box is refused. */
const resetTick = ref(0)

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

useAdminChanges({ onEntity: (entity) => { if (entity === 'settings') void load() } })

onBeforeUnmount(() => { if (savedTimer) clearTimeout(savedTimer) })

function label(key: keyof Settings): string {
  return SETTINGS_LABELS[key] ?? String(key)
}

function errorFor(key: string): string | null {
  return fieldError.value?.key === key ? fieldError.value.text : null
}

function hintFor(field: NumFieldDef): string {
  if (!settings.value || !published.has(field.key)) return field.hint
  return `${field.hint} U Pravilima: ${formatSetting(field.key, settings.value)}.`
}

/**
 * The schema's own bounds, in Bosnian, before the request leaves. The server
 * would answer a 400 whose sentence is only "Zahtjev nije ispravan.".
 */
function localError(key: keyof Settings, value: unknown): string | null {
  const parsed = settingsSchema.safeParse({ [key]: value })
  if (parsed.success) return null
  const issue = parsed.error.issues[0] as { code?: string, minimum?: number | bigint, maximum?: number | bigint } | undefined
  const shown = (bound: number | bigint | undefined) =>
    (settings.value && bound !== undefined
      ? formatSetting(key, { ...settings.value, [key]: Number(bound) })
      : String(bound))
  if (issue?.code === 'too_small') {
    return Array.isArray(value) ? 'Bar jedna uloga mora ostati označena.' : `Najmanje ${shown(issue.minimum)}.`
  }
  if (issue?.code === 'too_big') return `Najviše ${shown(issue.maximum)}.`
  return 'Upiši cijeli broj.'
}

async function save(key: keyof Settings, value: number | Role[]) {
  if (!settings.value) return
  const current = settings.value[key]
  if (JSON.stringify(current) === JSON.stringify(value)) return

  const refused = localError(key, value)
  if (refused) {
    fieldError.value = { key, text: refused }
    return
  }

  pendingKey.value = key
  fieldError.value = null
  try {
    settings.value = await api.updateSettings({ [key]: value } as SettingsPatch)
    await me.load()
    savedKey.value = key
    if (savedTimer) clearTimeout(savedTimer)
    savedTimer = setTimeout(() => { savedKey.value = null }, 2000)
  } catch (err) {
    // Re-read first, so the refused value goes back to what the server holds.
    await load()
    fieldError.value = { key, text: apiErrorText(err, 'Nije snimljeno.') }
  } finally {
    pendingKey.value = null
  }
}

function commitNum(field: NumFieldDef, value: number | null) {
  if (value === null) {
    // An emptied box is not a value. The model did not move, so the field would
    // not re-seed itself; a new key remounts it showing the stored number.
    fieldError.value = { key: field.key, text: 'Polje ne može biti prazno.' }
    resetTick.value++
    return
  }
  void save(field.key, value)
}

function toggleRole(key: 'approver_roles' | 'payout_approver_roles', role: Role, on: boolean) {
  if (!settings.value) return
  const current = settings.value[key]
  const next = on
    ? ROLES.filter(r => r === role || current.includes(r))
    : current.filter(r => r !== role)
  if (next.length === 0) {
    fieldError.value = { key, text: 'Bar jedna uloga mora ostati označena — inače niko ne može odobriti.' }
    return
  }
  void save(key, next)
}

const workerApproves = computed(() => settings.value?.approver_roles.includes('radnik') ?? false)
</script>

<template>
  <div class="a-page">
    <UiPageHead
      eyebrow="Kontrolna ploča"
      title="Podešavanja"
      sub="Pragovi i ko odobrava"
    />

    <p v-if="error" class="p-page-error" role="alert">{{ error }}</p>

    <UiCard v-if="loading" title="Podešavanja">
      <p class="p-skeleton" />
      <p class="p-skeleton" />
      <p class="p-skeleton" />
    </UiCard>

    <template v-else-if="settings">
      <p class="p-intro">
        Prag nije kazna: kad se pređe, stavka se označi za razgovor. Pragove
        označene sa „U Pravilima" radnici vide na svom telefonu; otvoren telefon
        pokaže novi broj kad se aplikacija ponovo otvori. Svaka izmjena se
        bilježi sa starom i novom vrijednošću.
      </p>

      <!-- Who approves first: it is the only thing between a worker and
           somebody else's money (CLAUDE.md), so it is not a row among numbers. -->
      <UiCard title="Ko odobrava">
        <p class="p-note">
          Ko smije odlučiti o tuđem novcu. Bar jedna uloga mora ostati označena.
        </p>

        <div class="p-roles-block">
          <div v-for="item in ROLE_SETTINGS" :key="item.key" class="p-roles">
            <span class="p-caption">
              {{ label(item.key) }}
              <UiPill v-if="savedKey === item.key" tone="good">sačuvano</UiPill>
            </span>
            <div class="p-role-list">
              <PostavkeToggle
                v-for="role in ROLES"
                :key="role"
                :model-value="settings[item.key].includes(role)"
                :label="`${label(item.key)}: ${ROLE_LABELS[role]}`"
                :disabled="pendingKey === item.key"
                words
                :on-label="ROLE_LABELS[role]"
                :off-label="ROLE_LABELS[role]"
                @update:model-value="on => toggleRole(item.key, role, on)"
              />
            </div>
            <span v-if="errorFor(item.key)" class="p-error-line" role="alert">{{ errorFor(item.key) }}</span>
            <span v-else class="p-hint">{{ item.hint }}</span>
          </div>
        </div>

        <p class="p-state" :class="{ warn: workerApproves }">
          <template v-if="workerApproves">
            Radnik može odobriti storno, otpis i predaju pazara kolege — i kad
            vlasnik nije u lokalu.
          </template>
          <template v-else>
            Samo vlasnik odobrava storno, otpis i predaju pazara. Dok se ne javi,
            zahtjev čeka.
          </template>
        </p>

        <div class="p-fields">
          <PostavkeNumField
            :key="`payout_owner_fen-${resetTick}`"
            :label="label('payout_owner_fen')"
            :model-value="settings.payout_owner_fen"
            kind="money"
            suffix="KM"
            hint="Isplata iznad ovoga čeka vlasnika, ko god je odobrio."
            :error="errorFor('payout_owner_fen')"
            :pending="pendingKey === 'payout_owner_fen'"
            @commit="value => commitNum({ key: 'payout_owner_fen', kind: 'money', hint: '' }, value)"
          >
            <template #badge>
              <UiPill v-if="savedKey === 'payout_owner_fen'" tone="good">sačuvano</UiPill>
            </template>
          </PostavkeNumField>
        </div>
      </UiCard>

      <UiCard v-for="group in GROUPS" :key="group.id" :title="group.title">
        <p class="p-note">{{ group.note }}</p>

        <div class="p-fields">
          <PostavkeNumField
            v-for="field in group.fields"
            :key="`${field.key}-${resetTick}`"
            :label="label(field.key)"
            :model-value="settings[field.key] as number"
            :kind="INPUT_KIND[field.kind]"
            :suffix="SUFFIX[field.kind]"
            :hint="hintFor(field)"
            :error="errorFor(field.key)"
            :pending="pendingKey === field.key"
            @commit="value => commitNum(field, value)"
          >
            <template #badge>
              <UiPill v-if="savedKey === field.key" tone="good">sačuvano</UiPill>
            </template>
          </PostavkeNumField>
        </div>
      </UiCard>
    </template>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

.p-page-error {
  margin: 0;
  padding: 10px 14px;
  border-radius: var(--radius-field);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: var(--text-label);
  font-weight: 500;
}

.p-skeleton {
  margin: 0 0 10px;
  height: 12px;
  border-radius: 6px;
  background: var(--surface-2);
}

.p-intro { margin: 0; color: var(--ink-2); font-size: var(--text-label); }
.p-note { margin: 0 0 12px; color: var(--muted); font-size: var(--text-micro); }

/* `auto-fill` with a maximum track: a threshold is four or five characters
   wide, and a 400 px box for "5,00" reads as a mistake. */
.p-fields {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 260px));
  justify-content: start;
  gap: 14px 20px;
  align-items: start;
}

.p-roles-block { display: flex; flex-wrap: wrap; gap: 14px 32px; margin-bottom: 12px; }
.p-roles { display: flex; flex-direction: column; gap: 6px; min-width: 0; }

.p-caption {
  font-size: var(--text-caption);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 20px;
}

.p-caption :deep(.a-pill) { text-transform: none; letter-spacing: 0; }

.p-role-list { display: flex; flex-wrap: wrap; gap: 4px 16px; }
.p-hint { font-size: var(--text-micro); color: var(--muted); }
.p-error-line { font-size: var(--text-micro); color: var(--danger); }

.p-state {
  margin: 0 0 14px;
  padding: 10px 14px;
  border-radius: var(--radius-field);
  background: var(--surface-2);
  color: var(--ink);
  font-size: var(--text-label);
}

.p-state.warn { background: var(--warn-soft); }

@media (max-width: 1023px) {
  .p-fields { grid-template-columns: minmax(0, 1fr); }
}
</style>
