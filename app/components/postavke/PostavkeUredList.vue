<script setup lang="ts">
/**
 * *Uređaji* as a list, for the phone.
 *
 * **A revoked phone is never deleted** — every round it locked still points at
 * it — so the list grows by one every time a waiter changes his phone, and a
 * year in, the café's four working phones are at the top of a column of eleven
 * dead ones. The laptop's table can afford that; a 390 px screen cannot.
 *
 * So the card holds the phones that are still in the café, and the ones that
 * are not are folded underneath it with their count on the summary. Nothing is
 * hidden and nothing is dropped: it is one tap, and the fold is `<details>`
 * rather than a toggle in script, because the browser already knows how to open
 * and announce one.
 */
import type { DeviceAdmin } from '#shared/types'

const props = defineProps<{
  devices: DeviceAdmin[]
  /** The first read has not landed: draw bars, not an empty screen. */
  loading: boolean
  /** `settings.heartbeat_fresh_s`. */
  freshS: number
  /** `settings.clock_skew_alert_s`. */
  skewAlertS: number
  /** Ticks every 30 s so "prije 4 min" ages without a second poll. */
  now: number
}>()

const emit = defineEmits<{ open: [device: DeviceAdmin] }>()

const live = computed(() => props.devices.filter(device => device.revoked_at === null))
const revoked = computed(() => props.devices.filter(device => device.revoked_at !== null))
</script>

<template>
  <div class="p-list">
    <div v-if="loading" class="p-card p-skel" aria-hidden="true">
      <div v-for="n in 3" :key="n" class="p-skel-row">
        <span class="p-skel-bar wide" />
        <span class="p-skel-bar" />
      </div>
    </div>

    <template v-else>
      <div v-if="live.length > 0" class="p-card">
        <PostavkeUredRow
          v-for="device in live"
          :key="device.id"
          :device="device"
          :fresh-s="freshS"
          :skew-alert-s="skewAlertS"
          :now="now"
          @open="emit('open', device)"
        />
      </div>

      <p v-else-if="revoked.length === 0" class="p-empty">
        Nijedan uređaj još nije prijavljen.
      </p>

      <p v-else class="p-empty">Nijedan telefon trenutno ne radi u lokalu.</p>

      <details v-if="revoked.length > 0" class="p-fold">
        <summary>
          <span class="p-fold-line">Povučeni uređaji</span>
          <span class="p-fold-n num">{{ revoked.length }}</span>
          <UiIcon class="p-fold-chev" name="chevron-right" :size="18" />
        </summary>

        <div class="p-card p-card-in">
          <PostavkeUredRow
            v-for="device in revoked"
            :key="device.id"
            :device="device"
            :fresh-s="freshS"
            :skew-alert-s="skewAlertS"
            :now="now"
            @open="emit('open', device)"
          />
        </div>
      </details>
    </template>
  </div>
</template>

<style scoped>
.p-list { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

.p-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  overflow: hidden;
  min-width: 0;
}

/* Inside the fold there is already a card's worth of chrome around it, so this
   one is a plainer box: a rule and a radius, no shadow of its own. */
.p-card-in { box-shadow: none; margin-top: 8px; }

.p-skel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 16px;
  border-bottom: 1px solid var(--line-soft);
}

.p-skel-row:last-child { border-bottom: 0; }

.p-skel-bar {
  display: block;
  height: 10px;
  width: 72px;
  border-radius: var(--radius-chip);
  background: var(--surface-2);
}

.p-skel-bar.wide { width: 45%; }

.p-empty {
  margin: 0;
  padding: 22px 16px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-card);
  color: var(--muted);
  font-size: var(--text-body);
  text-align: center;
}

/* ---- the fold ----------------------------------------------------------- */

.p-fold { min-width: 0; }

.p-fold summary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: var(--tap);
  padding: 0 4px;
  cursor: pointer;
  list-style: none;
  font-size: var(--text-label);
  font-weight: 600;
  color: var(--ink-2);
}

/* Safari draws its own triangle; the chevron is the disclosure here. */
.p-fold summary::-webkit-details-marker { display: none; }
.p-fold summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

.p-fold-line { flex-grow: 1; min-width: 0; }
.p-fold-n { color: var(--muted); font-weight: 500; }

.p-fold-chev {
  flex-shrink: 0;
  color: var(--muted);
  transition: transform var(--dur-fast) var(--ease-standard);
}

.p-fold[open] .p-fold-chev { transform: rotate(90deg); }
</style>
