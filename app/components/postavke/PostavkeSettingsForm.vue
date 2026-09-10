<script setup lang="ts">
/**
 * *Podešavanja* — the thresholds the café runs on.
 *
 * **Each field saves by itself.** There is no Save button at the bottom: the
 * owner comes here to change one number, and a form that has to be submitted is
 * a form somebody leaves half-typed with a shift about to open. A field that has
 * gone through shows *sačuvano* for two seconds and then goes quiet again.
 *
 * **Money is typed in KM and sent in feninga.** `cash_tolerance_fen` is 500 in
 * the database and "5,00 KM" in the box; nothing between the two is ever a
 * float, because a column of floats that each look right sums to 0,01 KM wrong.
 *
 * Two settings that look like money and are not: the percentages. They are the
 * *other* half of the tolerance — a close is inside tolerance when it is within
 * `max(fen, expected × pct/100)`, so a big night gets a proportionally bigger
 * margin than a quiet one.
 */
import { SETTINGS_LABELS, type Settings } from '#shared/settings'
import type { Role } from '#shared/types'

const props = defineProps<{
  settings: Settings
  /** The key whose write just landed — it shows *sačuvano* for two seconds. */
  savedKey: string | null
  /** The key whose write is in flight. */
  pendingKey: string | null
  /** `[key, Bosnian sentence]` when the last write was refused. */
  fieldError: { key: string, text: string } | null
}>()

const emit = defineEmits<{ save: [key: keyof Settings, value: number | Role[]] }>()

/** How a value is typed, and what the quiet line under it says. */
type FieldKind = 'money' | 'pct' | 'sec' | 'count' | 'gram'

interface Field {
  key: keyof Settings
  kind: FieldKind
  hint?: string
}

interface Group {
  title: string
  note: string
  fields: Field[]
}

const GROUPS: Group[] = [
  {
    title: 'Tolerancije',
    note: 'Koliko gotovine smije faliti prije nego se traži objašnjenje.',
    fields: [
      { key: 'cash_tolerance_fen', kind: 'money' },
      { key: 'cash_tolerance_pct', kind: 'pct', hint: 'Vrijedi ono što je veće od ova dva.' },
      { key: 'variance_alert_fen', kind: 'money', hint: 'Manjak robe iznad ovoga ide u Dnevnik.' },
    ],
  },
  {
    title: 'Storna',
    note: 'Šta konobar smije poništiti sam, bez pitanja.',
    fields: [
      { key: 'void_self_window_s', kind: 'sec', hint: 'Nakon zaključavanja ture.' },
      { key: 'self_void_max_per_shift', kind: 'count' },
      { key: 'self_void_max_fen', kind: 'money' },
    ],
  },
  {
    title: 'Gratis',
    note: 'Iznad ovih iznosa gratis traži vlasnika.',
    fields: [
      { key: 'comp_large_fen', kind: 'money' },
      { key: 'comp_shift_fen', kind: 'money', hint: 'Zbir po smjeni.' },
    ],
  },
  {
    title: 'Otpis',
    note: 'Koliko se smije otpisati prije nego se traži PIN.',
    fields: [
      { key: 'waste_pin_threshold_fen', kind: 'money' },
      { key: 'waste_shift_fen', kind: 'money', hint: 'Zbir po smjeni.' },
    ],
  },
  {
    title: 'Isplate',
    note: 'Novac koji izlazi iz kase tokom smjene.',
    fields: [
      { key: 'payout_owner_fen', kind: 'money' },
    ],
  },
  {
    title: 'Nargila',
    note: 'Očekivana potrošnja duhana i žara po luli.',
    fields: [
      { key: 'grams_per_bowl_default', kind: 'gram' },
      { key: 'gpb_band_pct', kind: 'pct', hint: 'Koliko smije odstupati prije nego se javi.' },
      { key: 'coals_per_bowl_alert', kind: 'count' },
    ],
  },
  {
    title: 'Uređaji',
    note: 'Kad se telefon smatra tihim i kad mu sat previše odstupa.',
    fields: [
      { key: 'heartbeat_fresh_s', kind: 'sec' },
      { key: 'clock_skew_alert_s', kind: 'sec' },
      { key: 'shared_device_idle_s', kind: 'sec', hint: 'Zajednički telefon se sam odjavi.' },
    ],
  },
]

const SUFFIX: Record<FieldKind, string> = {
  money: 'KM',
  pct: '%',
  sec: 's',
  count: 'kom',
  gram: 'g',
}

const NUM_KIND: Record<FieldKind, 'money' | 'decimal' | 'int'> = {
  money: 'money',
  pct: 'decimal',
  sec: 'int',
  count: 'int',
  gram: 'decimal',
}

const ROLES: Array<{ value: Role, label: string }> = [
  { value: 'admin', label: 'Vlasnik' },
  { value: 'bartender', label: 'Šanker' },
  { value: 'waiter', label: 'Konobar' },
]

function labelOf(key: keyof Settings): string {
  return SETTINGS_LABELS[key] ?? String(key)
}

function valueOf(key: keyof Settings): number {
  return props.settings[key] as number
}

function errorFor(key: string): string | null {
  return props.fieldError?.key === key ? props.fieldError.text : null
}

/** `payout_approver_roles` must keep at least one role, or nobody may approve. */
function toggleRole(role: Role, on: boolean) {
  const current = props.settings.payout_approver_roles
  const next = on ? [...current, role] : current.filter(r => r !== role)
  if (next.length === 0) return
  emit('save', 'payout_approver_roles', next)
}
</script>

<template>
  <div class="p-groups">
    <UiCard v-for="group in GROUPS" :key="group.title" :title="group.title">
      <p class="p-note">{{ group.note }}</p>

      <div class="p-fields">
        <PostavkeNumField
          v-for="field in group.fields"
          :key="field.key"
          :label="labelOf(field.key)"
          :model-value="valueOf(field.key)"
          :kind="NUM_KIND[field.kind]"
          :suffix="SUFFIX[field.kind]"
          :hint="field.hint"
          :error="errorFor(field.key)"
          :pending="pendingKey === field.key"
          @commit="value => value !== null && emit('save', field.key, value)"
        >
          <template #badge>
            <UiPill v-if="savedKey === field.key" tone="good">sačuvano</UiPill>
          </template>
        </PostavkeNumField>

        <!-- Isplate carries the one setting that is a list of roles, not a
             number: who is allowed to approve money leaving the drawer. -->
        <div v-if="group.title === 'Isplate'" class="p-roles">
          <span class="p-caption">
            {{ labelOf('payout_approver_roles') }}
            <UiPill v-if="savedKey === 'payout_approver_roles'" tone="good">sačuvano</UiPill>
          </span>
          <div class="p-role-list">
            <PostavkeToggle
              v-for="role in ROLES"
              :key="role.value"
              :model-value="settings.payout_approver_roles.includes(role.value)"
              :label="role.label"
              :disabled="pendingKey === 'payout_approver_roles'"
              words
              :on-label="role.label"
              :off-label="role.label"
              @update:model-value="on => toggleRole(role.value, on)"
            />
          </div>
          <span v-if="errorFor('payout_approver_roles')" class="p-error-line">
            {{ errorFor('payout_approver_roles') }}
          </span>
          <span v-else class="p-hint">Bar jedna uloga mora ostati označena.</span>
        </div>
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.p-groups { display: flex; flex-direction: column; gap: 14px; }

.p-note { margin: 0; color: var(--muted); font-size: var(--text-micro); }

/* `auto-fill` with a *maximum* track, not `1fr`: a threshold is four or five
   characters wide, and a 400 px box for "5,00" reads as a mistake. */
.p-fields {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 240px));
  justify-content: start;
  gap: 14px 20px;
  align-items: start;
}

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

.p-role-list { display: flex; flex-wrap: wrap; gap: 12px; }
.p-hint { font-size: var(--text-micro); color: var(--muted); }
.p-error-line { font-size: var(--text-micro); color: var(--danger); }

@media (max-width: 1023px) {
  .p-fields { grid-template-columns: 1fr; }
}
</style>
