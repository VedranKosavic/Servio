<script setup lang="ts">
/**
 * One enrolled phone.
 *
 * Three of its columns are the reason this screen exists at all:
 *
 * - **Neposlano** — how many locked rounds are still sitting in that phone's
 *   outbox. A number here means money the app knows about and the ledger does
 *   not yet, so it is the first thing to look at when a shift will not add up.
 * - **Javio se** — the heartbeat. A phone that has not checked in within
 *   `heartbeat_fresh_s` is not necessarily broken (it may simply be off), so it
 *   is reported rather than treated as an error.
 * - **Sat** — how far the phone's clock is from the server's. A skewed clock
 *   writes rounds at the wrong minute, which is why it is flagged and why the
 *   server clamps what a phone claims about time.
 *
 * A device is revoked, never deleted: the rounds it locked keep pointing at it.
 *
 * **Otključaj is offered on every live phone, not only on a flagged one.** Of
 * the three lockout steps only the last writes `devices.locked_at`: five wrong
 * PINs are 60 seconds and ten are 15 minutes, and both of those are *counted*
 * in `auth_attempts` rather than flagged — with the pad's failures filed against
 * nobody, so no PIN reset reaches them either. A button that appeared only for
 * the flag was therefore missing in the two cases the bar actually hits, and the
 * *zaključan* pill only ever names the third. `unlockDevice` clears the flag and
 * the counter together and is safe to press on a phone that is fine.
 */
import type { DeviceAdmin } from '#shared/types'

const props = defineProps<{
  device: DeviceAdmin
  /** `settings.heartbeat_fresh_s` — how long a phone may stay quiet. */
  freshS: number
  /** `settings.clock_skew_alert_s`. */
  skewAlertS: number
  pending: boolean
  /** Ticks every 30 s so "prije 4 min" ages without a second poll. */
  now: number
}>()

const emit = defineEmits<{ rename: [], revoke: [], unlock: [] }>()

const revoked = computed(() => props.device.revoked_at !== null)
const locked = computed(() => props.device.locked_at !== null)

/** Seconds since the last heartbeat, or `null` for a phone that never sent one. */
const quietFor = computed<number | null>(() => {
  if (!props.device.last_seen_at) return null
  const seen = Date.parse(props.device.last_seen_at)
  return Number.isNaN(seen) ? null : Math.max(0, (props.now - seen) / 1000)
})

const stale = computed(() =>
  !revoked.value && (quietFor.value === null || quietFor.value > props.freshS))

const skewed = computed(() =>
  Math.abs(props.device.clock_skew_s) > props.skewAlertS)
</script>

<template>
  <tr :class="{ off: revoked }">
    <td>
      <div class="p-label">
        <strong>{{ device.label }}</strong>
        <small>{{ device.mode === 'personal' ? 'lični' : 'zajednički' }}</small>
      </div>
    </td>

    <td>
      <span v-if="device.bound_user_name">{{ device.bound_user_name }}</span>
      <span v-else class="p-muted">—</span>
    </td>

    <td>
      <UiPill v-if="revoked" tone="neutral">povučen</UiPill>
      <UiPill v-else-if="locked" tone="bad">zaključan</UiPill>
      <UiPill v-else tone="good">aktivan</UiPill>
    </td>

    <td class="r">
      <UiPill v-if="device.pending_count > 0" tone="warn">
        {{ device.pending_count }} neposlano
      </UiPill>
      <span v-else class="p-muted">0</span>
    </td>

    <td>
      <span v-if="quietFor === null" class="p-muted">nikad</span>
      <UiPill v-else-if="stale" tone="warn">ne javlja se · {{ durationBs(quietFor) }}</UiPill>
      <span v-else class="p-quiet">
        {{ quietFor < 60 ? 'upravo' : `prije ${durationBs(quietFor)}` }}
      </span>
    </td>

    <td class="r">
      <UiPill v-if="skewed" tone="warn">{{ durationBs(Math.abs(device.clock_skew_s)) }}</UiPill>
      <span v-else class="p-muted">u redu</span>
    </td>

    <td>
      <span v-if="device.app_version">{{ device.app_version }}</span>
      <span v-else class="p-muted">—</span>
    </td>

    <td class="r">
      <div class="p-actions">
        <UiButton small variant="ghost" :disabled="pending" @click="emit('rename')">
          Preimenuj
        </UiButton>
        <UiButton
          v-if="!revoked"
          small
          :variant="locked ? 'soft' : 'ghost'"
          :disabled="pending"
          @click="emit('unlock')"
        >Otključaj</UiButton>
        <UiButton
          v-if="!revoked"
          small
          variant="danger"
          :disabled="pending"
          @click="emit('revoke')"
        >Povuci</UiButton>
      </div>
    </td>
  </tr>
</template>

<style scoped>
.off td { opacity: 0.55; }
.p-label { display: flex; flex-direction: column; gap: 1px; min-width: 130px; }
.p-label small { color: var(--muted); font-size: var(--text-caption); }
.p-muted { color: var(--muted); }
.p-quiet { color: var(--ink-2); font-variant-numeric: tabular-nums; }
/* Three buttons since *Otključaj* stopped hiding itself, and they stay on one
   line: the table scrolls sideways inside its own box (UiTable), which is the
   app's rule for wide content, and a *Povuci* that wraps under the row it
   belongs to reads like a button for the next device. */
.p-actions { display: inline-flex; gap: 6px; justify-content: flex-end; flex-wrap: nowrap; }
.p-actions :deep(button) { white-space: nowrap; }
</style>
