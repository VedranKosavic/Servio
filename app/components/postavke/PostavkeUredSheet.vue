<script setup lang="ts">
/**
 * Everything about one phone that is not its name, and everything that can be
 * done to it.
 *
 * On a laptop these are six columns of a table and they are fine there. On a
 * phone they were off the right edge behind a horizontal scrollbar, which is the
 * same as not existing — so below 1024 px they live here, one per line, each
 * with the sentence that says what it means. The table has never had room for
 * those sentences, and *Neposlano* is exactly the number that needs one.
 *
 * **Povuci asks first.** In the table it is one click, and at a desk that is
 * survivable. On a phone the same button is a thumb's width from a list the
 * owner is scrolling, and what it does is cut a working phone out of the café
 * mid-shift. So it swaps the row of actions for a sentence saying what will
 * happen and a button that says it again. *Otključaj* does not ask, because
 * pressing it on a phone that is fine changes nothing.
 *
 * **Preimenuj hands over rather than stacking.** Two scrims on a phone is one
 * scrim too many, so this sheet closes and `PostavkeRenameSheet` opens in its
 * place — the same handover *Meni* makes to the recipe editor.
 *
 * `device` is looked up fresh by the page on every render, so an unlock landing
 * while the sheet is open moves the pill under it rather than leaving a state
 * the database does not have.
 */
import type { DeviceAdmin } from '#shared/types'

const props = defineProps<{
  open: boolean
  device: DeviceAdmin | null
  /** `settings.heartbeat_fresh_s` — how long a phone may stay quiet. */
  freshS: number
  /** `settings.clock_skew_alert_s`. */
  skewAlertS: number
  /** Ticks every 30 s so "prije 4 min" ages without a second poll. */
  now: number
  /** A write for this device is in flight. */
  pending: boolean
}>()

const emit = defineEmits<{
  close: []
  /** Hand over to `PostavkeRenameSheet`; the page closes this sheet first. */
  rename: []
  unlock: []
  revoke: []
}>()

/** The confirm step for *Povuci*, and nothing else in this sheet needs one. */
const confirming = ref(false)

/**
 * Backed out when the sheet opens or changes device — and **only** then.
 *
 * The source is one string rather than an array of the two values: the page
 * looks its device up fresh on every render, so `props.device` is a new object
 * after each 15 s poll, and a watcher whose source is a new array every time
 * fires every time. That would have pulled the confirm out from under a thumb
 * mid-tap and put *Preimenuj* and *Otključaj* back where *Odustani* and *Povuci
 * uređaj* were standing.
 */
watch(() => `${props.open}:${props.device?.id ?? ''}`, () => { confirming.value = false })

const revoked = computed(() => props.device?.revoked_at != null)
const locked = computed(() => props.device?.locked_at != null)

const quietFor = computed<number | null>(() => {
  if (!props.device?.last_seen_at) return null
  const seen = Date.parse(props.device.last_seen_at)
  return Number.isNaN(seen) ? null : Math.max(0, (props.now - seen) / 1000)
})

const stale = computed(() => quietFor.value === null || quietFor.value > props.freshS)

const skew = computed(() => Math.abs(props.device?.clock_skew_s ?? 0))
const skewed = computed(() => skew.value > props.skewAlertS)

/** Whose phone it is, and since when — the line under the title. */
const summary = computed(() => {
  const device = props.device
  if (!device) return ''
  const whose = device.mode === 'personal'
    ? (device.bound_user_name ? `lični · ${device.bound_user_name}` : 'lični')
    : 'zajednički'
  return `${whose} · prijavljen ${dateBs(device.enrolled_at)}`
})

const seen = computed(() => {
  const quiet = quietFor.value
  if (quiet === null) return 'nikad'
  return quiet < 60 ? 'upravo' : `prije ${durationBs(quiet)}`
})

const stateHint = computed(() => {
  if (revoked.value) return 'Telefon više ne može raditi u lokalu.'
  if (locked.value) return 'Previše pogrešnih PIN-ova. Otključaj ga ispod.'
  return 'Telefon smije raditi u lokalu.'
})
</script>

<template>
  <UiSheet
    :open="open"
    :title="device?.label ?? 'Uređaj'"
    :content-key="`${device?.id ?? ''}${confirming ? ':povuci' : ''}`"
    @close="emit('close')"
  >
    <template v-if="device">
      <p class="p-sum">{{ summary }}</p>

      <div class="p-facts">
        <div class="p-fact">
          <span class="p-fact-text">
            <span class="p-fact-label">Stanje</span>
            <span class="p-fact-hint">{{ stateHint }}</span>
          </span>
          <UiPill v-if="revoked" tone="neutral">povučen</UiPill>
          <UiPill v-else-if="locked" tone="bad">zaključan</UiPill>
          <UiPill v-else tone="good">aktivan</UiPill>
        </div>

        <div class="p-fact">
          <span class="p-fact-text">
            <span class="p-fact-label">Neposlano</span>
            <span class="p-fact-hint">
              Zaključane ture koje još nisu stigle na server.
            </span>
          </span>
          <UiPill v-if="device.pending_count > 0" tone="warn">
            <span class="num">{{ device.pending_count }}</span>
          </UiPill>
          <span v-else class="p-fact-value num">0</span>
        </div>

        <div class="p-fact">
          <span class="p-fact-text">
            <span class="p-fact-label">Javio se</span>
            <span class="p-fact-hint">
              {{ stale
                ? 'Telefon je možda ugašen ili bez interneta.'
                : 'Telefon se redovno javlja.' }}
            </span>
          </span>
          <UiPill v-if="!revoked && stale" tone="warn">
            <span class="num">{{ seen }}</span>
          </UiPill>
          <span v-else class="p-fact-value num">{{ seen }}</span>
        </div>

        <div class="p-fact">
          <span class="p-fact-text">
            <span class="p-fact-label">Sat</span>
            <span class="p-fact-hint">Razlika prema satu servera.</span>
          </span>
          <UiPill v-if="skewed" tone="warn">
            <span class="num">{{ durationBs(skew) }}</span>
          </UiPill>
          <span v-else class="p-fact-value">u redu</span>
        </div>

        <div class="p-fact">
          <span class="p-fact-text">
            <span class="p-fact-label">Verzija</span>
            <span class="p-fact-hint">Koju verziju aplikacije telefon vrti.</span>
          </span>
          <span class="p-fact-value num">{{ device.app_version ?? '—' }}</span>
        </div>
      </div>

      <div v-if="!confirming" class="p-acts">
        <UiButton variant="ghost" :disabled="pending" @click="emit('rename')">
          Preimenuj
        </UiButton>
        <UiButton
          v-if="!revoked"
          :variant="locked ? 'soft' : 'ghost'"
          :disabled="pending"
          @click="emit('unlock')"
        >Otključaj</UiButton>
        <UiButton
          v-if="!revoked"
          variant="danger"
          :disabled="pending"
          @click="confirming = true"
        >Povuci</UiButton>
      </div>

      <div v-else class="p-confirm">
        <p class="p-danger">
          Telefon odmah gubi pristup i mora se ponovo prijaviti novim kodom. Ture
          koje je zaključao ostaju u evidenciji.
        </p>
        <div class="p-acts">
          <UiButton variant="ghost" :disabled="pending" @click="confirming = false">
            Odustani
          </UiButton>
          <UiButton variant="danger" :pending="pending" @click="emit('revoke')">
            Povuci uređaj
          </UiButton>
        </div>
      </div>
    </template>

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Gotovo</UiButton>
    </template>
  </UiSheet>
</template>

<style scoped>
.p-sum { margin: 0; color: var(--muted); font-size: var(--text-micro); }

/* One list, one rule between lines — the sheet body's own gap would put air
   between rows that are meant to read as one block. */
.p-facts { display: flex; flex-direction: column; }

.p-fact {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: var(--tap);
  padding: 9px 0;
  border-bottom: 1px solid var(--line-soft);
}

.p-fact:last-child { border-bottom: 0; }

.p-fact-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex-grow: 1; }

.p-fact-label {
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--ink);
}

.p-fact-hint { font-size: var(--text-micro); color: var(--muted); }

.p-fact-value { font-size: var(--text-label); color: var(--ink-2); white-space: nowrap; }

.p-acts { display: flex; flex-wrap: wrap; gap: 8px; }

.p-confirm { display: flex; flex-direction: column; gap: 10px; }

.p-danger {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-field);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: var(--text-micro);
  font-weight: 500;
}
</style>
