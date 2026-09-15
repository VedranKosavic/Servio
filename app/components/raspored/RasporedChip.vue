<script setup lang="ts">
/**
 * One person in one cell of the weekly pattern — `/admin`, light kit.
 *
 * The whole chip is the button, because on a phone the target is the chip and
 * not a caret hidden inside it. It opens the small sheet whose one action is
 * *Ukloni sa smjene*.
 */
import type { PatternEntry } from '#shared/types'

defineProps<{ person: PatternEntry }>()

defineEmits<{ open: [] }>()
</script>

<template>
  <button type="button" class="r-chip" @click="$emit('open')">
    <span class="r-in">{{ person.user_initials }}</span>
    <span class="r-nm">{{ person.user_name }}</span>
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

@media (max-width: 1023px) {
  /* A thumb, not a mouse pointer. */
  .r-chip { min-height: 44px; font-size: var(--text-body); padding-right: 12px; }
  .r-in { width: 36px; height: 36px; border-radius: 18px; font-size: var(--text-micro); }
}
</style>
