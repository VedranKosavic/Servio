<script setup lang="ts">
/**
 * The button. 38 px on a laptop, **44 px below 1024 px** — a thumb needs more
 * than a mouse pointer does, and every interactive target on the phone layout
 * has to clear 44 px.
 *
 * Four variants and nothing else, so the page's hierarchy is legible from ten
 * feet away: **one** copper `primary` per screen (the thing this page is for),
 * `ghost` for everything beside it, `soft` for a control that is part of the
 * furniture, `danger` for the one that cannot be undone — a soft ground with
 * danger ink, never a solid red slab.
 *
 * `pending` disables the button and shows a spinner in place of the label's
 * icon, so a double tap cannot post a decision twice.
 */
withDefaults(defineProps<{
  variant?: 'primary' | 'ghost' | 'soft' | 'danger'
  pending?: boolean
  disabled?: boolean
  type?: 'button' | 'submit'
  /** A 34 px inline action inside a table row or an attention row. */
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
  height: 38px;
  border-radius: var(--radius-field);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 16px;
  font: inherit;
  font-weight: 600;
  font-size: var(--text-label);
  white-space: nowrap;
  border: 1px solid transparent;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-standard),
    border-color var(--dur-fast) var(--ease-standard),
    transform var(--dur-tap) var(--ease-standard);
}

/* Tap feedback: the surface acknowledges the touch, the layout does not move. */
.a-btn:active:not(:disabled) { transform: scale(0.97); }
.a-btn:disabled { opacity: 0.5; cursor: default; }

.v-primary { background: var(--accent); color: var(--on-accent); box-shadow: var(--shadow-card); }
.v-primary:hover:not(:disabled) { background: var(--accent-text); }

.v-ghost { background: var(--surface); border-color: var(--line); color: var(--ink); }
.v-ghost:hover:not(:disabled) { background: var(--surface-3); border-color: var(--muted); }

.v-soft { background: var(--surface-2); color: var(--ink-2); }
.v-soft:hover:not(:disabled) { background: var(--bg-2); color: var(--ink); }

.v-danger { background: var(--danger-soft); color: var(--danger); }
.v-danger:hover:not(:disabled) { background: var(--danger); color: var(--on-accent); }

.small { height: 34px; padding: 0 12px; font-size: var(--text-micro); }

.a-spin {
  width: 14px;
  height: 14px;
  border-radius: var(--radius-chip);
  border: 2px solid currentColor;
  border-top-color: transparent;
  animation: a-spin 0.7s linear infinite;
}

@keyframes a-spin { to { transform: rotate(360deg); } }

/* Below the breakpoint every target is a thumb's target — the small variant too. */
@media (max-width: 1023px) {
  .a-btn { height: 44px; font-size: var(--text-body); padding: 0 18px; }
  .small { height: 44px; padding: 0 14px; font-size: var(--text-label); }
}

/**
 * The waiter and bartender screens borrow this button (the roster lives on
 * `/konobar/raspored` and `/sanker/raspored` as well as on the dashboard), and
 * their floor is 48 px, not the dashboard's 44 — a tray in one hand, standing
 * up, in the dark. The dark theme is the absence of `data-theme='light'`, so
 * the primitive reads the *area* it is rendered in rather than the viewport,
 * and one component serves both without a second copy.
 */
html:not([data-theme='light']) .a-btn,
html:not([data-theme='light']) .a-btn.small {
  height: 48px;
  padding: 0 18px;
  font-size: var(--text-body);
  border-radius: var(--radius-control);
}

@media (prefers-reduced-motion: reduce) {
  .a-spin { animation-duration: 2s; }
}
</style>
