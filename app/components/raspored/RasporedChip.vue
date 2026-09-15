<script setup lang="ts">
/**
 * One person in one cell — `/admin`, light kit.
 *
 * The whole chip is the button, because on a phone the target is the chip and
 * not a caret hidden inside it. What it draws is only ever three things:
 *
 * - **a name on the plan** — plain, the ordinary case, so a full week is quiet;
 * - **removed** — the word *uklonjeno*, on a row the owner unfolded;
 * - **the drift note** — "staro 15–00" when this row's snapshotted hours differ
 *   from what the template says today.
 *
 * No swap and no sick or absent badge: those are gone from the app ("Ne trebaju
 * nam zamjene i bolovanje").
 */
import type { Assignment, ShiftTemplateView } from '#shared/types'

const props = defineProps<{
  person: Assignment
  /** The template as it stands today, to spot a row left on old hours. */
  template?: ShiftTemplateView
}>()

defineEmits<{ open: [] }>()

/** The row kept its own hours and the template has since moved. */
const drift = computed(() => {
  const t = props.template
  if (!t) return null
  if (t.start_time === props.person.start_time && t.end_time === props.person.end_time) return null
  return `staro ${timeSpanBs(props.person.start_time, props.person.end_time)}`
})
</script>

<template>
  <button type="button" class="r-chip" @click="$emit('open')">
    <span class="r-in">{{ person.user_initials }}</span>
    <span class="r-nm">{{ person.user_name }}</span>

    <small v-if="person.status === 'removed'" class="r-tag">{{ STATUS_BS.removed }}</small>
    <small v-if="drift" class="r-tag r-drift">{{ drift }}</small>
  </button>
</template>

<style scoped>
.r-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  max-width: 100%;
  padding: 2px 10px 2px 2px;
  border-radius: 16px;
  border: 1px solid var(--line);
  background: var(--surface);
  font: inherit;
  font-size: var(--text-micro);
  color: var(--ink);
  cursor: pointer;
  text-align: left;
}

.r-in {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 13px;
  background: var(--surface-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-caption);
  font-weight: 700;
  color: var(--ink-2);
}

.r-nm { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.r-tag { color: var(--ink-2); font-size: var(--text-caption); white-space: nowrap; }
.r-drift { color: var(--muted); }

@media (max-width: 1023px) {
  /* A thumb, not a mouse pointer. */
  .r-chip { min-height: 44px; font-size: var(--text-body); padding-right: 12px; }
  .r-in { width: 36px; height: 36px; border-radius: 18px; font-size: var(--text-micro); }
}
</style>
