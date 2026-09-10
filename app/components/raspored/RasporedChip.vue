<script setup lang="ts">
/**
 * One person in one cell — `/admin`, light kit.
 *
 * The whole chip is the button, because on a phone the target is the chip and
 * not a caret hidden inside it. What it draws is only ever four things:
 *
 * - **planned** — plain, the ordinary case, so a full week is quiet;
 * - **swap pending** — amber and the word *zamjena*, on both sides of the swap;
 * - **sick / absent** — struck through with the word, never a colour alone;
 * - **the drift note** — "staro 15–00" when this row's snapshotted hours differ
 *   from what the template says today.
 */
import type { Assignment, ShiftTemplateView } from '#shared/types'

const props = defineProps<{
  person: Assignment
  /** The template as it stands today, to spot a row left on old hours. */
  template?: ShiftTemplateView
}>()

defineEmits<{ open: [] }>()

const struck = computed(() =>
  props.person.status === 'sick' || props.person.status === 'absent')

const tone = computed(() => {
  if (props.person.swap_pending) return 'warn'
  if (props.person.status === 'sick' || props.person.status === 'absent') return 'bad'
  return 'plain'
})

/** The row kept its own hours and the template has since moved. */
const drift = computed(() => {
  const t = props.template
  if (!t) return null
  if (t.start_time === props.person.start_time && t.end_time === props.person.end_time) return null
  return `staro ${timeSpanBs(props.person.start_time, props.person.end_time)}`
})
</script>

<template>
  <button type="button" class="r-chip" :class="`t-${tone}`" @click="$emit('open')">
    <span class="r-in" :class="{ struck }">{{ person.user_initials }}</span>
    <span class="r-nm" :class="{ struck }">{{ person.user_name }}</span>

    <small v-if="person.swap_pending" class="r-tag">zamjena</small>
    <small v-else-if="person.status !== 'planned'" class="r-tag">{{ STATUS_BS[person.status] }}</small>
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
  font-size: 13px;
  color: var(--ink);
  cursor: pointer;
  text-align: left;
}

.t-warn { border-color: var(--warn); background: var(--warn-soft); }
.t-bad { border-color: var(--danger); background: var(--danger-soft); }

.r-in {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 13px;
  background: var(--surface-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--ink-2);
}

.r-nm { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.struck { text-decoration: line-through; }
.r-tag { color: var(--ink-2); font-size: 11px; white-space: nowrap; }
.r-drift { color: var(--muted); }

@media (max-width: 1023px) {
  /* A thumb, not a mouse pointer. */
  .r-chip { min-height: 44px; font-size: 15px; padding-right: 12px; }
  .r-in { width: 36px; height: 36px; border-radius: 18px; font-size: 13px; }
}
</style>
