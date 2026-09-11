<script setup lang="ts">
/**
 * One enrolled phone, the way a phone draws it.
 *
 * The laptop gets eight columns, and six of them are diagnostics: the outbox
 * depth, the heartbeat, the clock skew, the app version. Read at a desk that is
 * a fleet at a glance; read in a hand it is a sideways drag past the one thing
 * the owner came for, which is **which phone is this and is it all right.**
 *
 * So the row is the name, who has it, and marks — and a mark is drawn only when
 * there is something to say. A phone that is behaving carries one quiet line
 * saying when it last checked in; a phone that is not carries the word for what
 * is wrong with it:
 *
 * - **neposlano** — locked rounds still sitting in that phone's outbox. Money
 *   the app knows about and the ledger does not yet, so it is the first thing to
 *   look at when a shift will not add up.
 * - **ne javlja se** — no heartbeat within `heartbeat_fresh_s`. Not necessarily
 *   broken (it may simply be off), so it is reported rather than accused.
 * - **sat odstupa** — the phone's clock is far enough from the server's to write
 *   rounds at the wrong minute.
 * - **zaključan** — a run of wrong PINs flagged it.
 *
 * Everything else about the device, and everything that can be *done* to it,
 * is behind the chevron in `PostavkeUredSheet`. Nothing destructive is one tap
 * from a scrolling thumb.
 */
import type { DeviceAdmin } from '#shared/types'

const props = defineProps<{
  device: DeviceAdmin
  /** `settings.heartbeat_fresh_s` — how long a phone may stay quiet. */
  freshS: number
  /** `settings.clock_skew_alert_s`. */
  skewAlertS: number
  /** Ticks every 30 s so "prije 4 min" ages without a second poll. */
  now: number
}>()

const emit = defineEmits<{ open: [] }>()

const revoked = computed(() => props.device.revoked_at !== null)
const locked = computed(() => props.device.locked_at !== null)

/** Seconds since the last heartbeat, or `null` for a phone that never sent one. */
const quietFor = computed<number | null>(() => {
  if (!props.device.last_seen_at) return null
  const seen = Date.parse(props.device.last_seen_at)
  return Number.isNaN(seen) ? null : Math.max(0, (props.now - seen) / 1000)
})

const stale = computed(() => quietFor.value === null || quietFor.value > props.freshS)

const skewed = computed(() => Math.abs(props.device.clock_skew_s) > props.skewAlertS)

/** Whose phone it is — the name when there is one, the kind when there is not. */
const whose = computed(() => props.device.mode === 'personal'
  ? (props.device.bound_user_name ?? 'lični')
  : 'zajednički')

/**
 * The quiet half of the second line: whose phone it is and, when there is
 * nothing wrong with it, when it last checked in. One phrase rather than two
 * spans, so *zajednički* and *prije 5 min* read as a sentence instead of
 * colliding — everything that is a *warning* is a pill beside it, never text.
 */
const quiet = computed(() => {
  const seconds = quietFor.value
  if (revoked.value || stale.value || seconds === null) return whose.value
  const ago = seconds < 60 ? 'upravo' : `prije ${durationBs(seconds)}`
  return `${whose.value} · ${ago}`
})
</script>

<template>
  <button
    type="button"
    class="p-row"
    :class="{ off: revoked }"
    :aria-label="`Uređaj, ${device.label}`"
    @click="emit('open')"
  >
    <span class="p-text">
      <span class="p-name">{{ device.label }}</span>

      <span class="p-meta">
        <span class="p-quiet num">{{ quiet }}</span>

        <UiPill v-if="revoked" tone="neutral">povučen</UiPill>

        <template v-else>
          <UiPill v-if="locked" tone="bad">zaključan</UiPill>
          <UiPill v-if="device.pending_count > 0" tone="warn">
            <span class="num">{{ device.pending_count }}</span> neposlano
          </UiPill>
          <UiPill v-if="quietFor === null" tone="warn">nije se javio</UiPill>
          <UiPill v-else-if="stale" tone="warn">
            ne javlja se · <span class="num">{{ durationBs(quietFor) }}</span>
          </UiPill>
          <UiPill v-if="skewed" tone="warn">sat odstupa</UiPill>
        </template>
      </span>
    </span>

    <UiIcon name="chevron-right" :size="20" class="p-chev" />
  </button>
</template>

<style scoped>
/* The whole row is the way in, so the target is the row and not a 20 px
   chevron at the end of it. */
.p-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  min-height: var(--tap);
  padding: 10px 10px 10px 16px;
  border: 0;
  border-bottom: 1px solid var(--line-soft);
  background: transparent;
  font: inherit;
  text-align: left;
  color: var(--ink);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}

.p-row:last-child { border-bottom: 0; }
.p-row:hover { background: var(--surface-2); }
.p-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

/* Out of the café: still readable and still openable, just quieter — and the
   *povučen* pill says it in a word as well. */
.p-row.off .p-text { opacity: 0.6; }

.p-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex-grow: 1; }

.p-name {
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--ink);
  line-height: 1.3;
}

.p-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 6px;
  min-width: 0;
}

.p-quiet { font-size: var(--text-micro); color: var(--muted); }

.p-chev { flex-shrink: 0; color: var(--muted); }
</style>
