<script setup lang="ts">
/**
 * The button. 36 px on a laptop, **44 px below 1024 px** — a thumb needs more
 * than a mouse pointer does, and every interactive target on the phone layout
 * has to clear 44 px.
 *
 * `pending` disables the button and shows a spinner in place of the label's
 * icon, so a double tap cannot post a decision twice.
 */
withDefaults(defineProps<{
  variant?: 'primary' | 'ghost' | 'soft' | 'danger'
  pending?: boolean
  disabled?: boolean
  type?: 'button' | 'submit'
  /** A 32 px inline action inside a table row or an attention row. */
  small?: boolean
}>(), { variant: 'ghost', pending: false, disabled: false, type: 'button', small: false })
</script>

<template>
  <button
    class="a-btn"
    :class="[`v-${variant}`, { small, pending }]"
    :type="type"
    :disabled="disabled || pending"
  >
    <span v-if="pending" class="a-spin" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped>
.a-btn {
  height: 36px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 14px;
  font: inherit;
  font-weight: 600;
  font-size: 14px;
  white-space: nowrap;
  border: 1px solid transparent;
  cursor: pointer;
}

.a-btn:disabled { opacity: 0.5; cursor: default; }

.v-primary { background: var(--accent); color: var(--on-accent); }
.v-ghost { background: var(--surface); border-color: var(--line); color: var(--ink); }
.v-soft { background: var(--surface-2); color: var(--ink); }
.v-danger { background: var(--danger-soft); color: var(--danger); }

.small { height: 32px; border-radius: 8px; padding: 0 10px; font-size: 13px; }

.a-spin {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid currentColor;
  border-top-color: transparent;
  animation: a-spin 0.7s linear infinite;
}

@keyframes a-spin { to { transform: rotate(360deg); } }

/* Below the breakpoint every target is a thumb's target — the small variant too. */
@media (max-width: 1023px) {
  .a-btn { height: 44px; font-size: 15px; padding: 0 16px; }
  .small { height: 44px; padding: 0 14px; }
}

@media (prefers-reduced-motion: reduce) {
  .a-spin { animation-duration: 2s; }
}
</style>
