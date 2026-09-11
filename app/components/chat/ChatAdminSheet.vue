<script setup lang="ts">
/**
 * The option sheet, in the light kit — *Poruka*, *Utišaj*, *Iznosi u kanalu*.
 *
 * `/konobar` has `ChatMessageSheet` and `ChatMoneySheet`, and this is not a
 * re-skin of either: those are written in the dark kit's Tailwind classes, and
 * `/admin` is light (PHASE4 §1, "the light kit re-implements rather than
 * re-skins"). What *is* shared is the shape — a scrim, a panel, a column of
 * rows — so the page at `/admin/razgovor` and `ChatDock` use this one component
 * instead of the three hand-written copies the page used to carry.
 *
 * The rows are data rather than a slot on purpose: a slot is rendered in the
 * parent's scope, so every caller would have had to restate the row's CSS, and
 * restating it is exactly how the three copies drifted in the first place.
 *
 * `useSheetDismiss` gives it the two manners every sheet in this app owes: it
 * closes on Escape, and the page behind it stops scrolling while it is open.
 */
defineProps<{
  /** The dialog's accessible name — read instead of "dialog". */
  label: string
  /** The question above the rows, when the sheet asks one. */
  title?: string
  /**
   * The rows, top to bottom. `danger` is a destructive one, `muted` the way
   * out; `disabled` is the caller's own busy flag, per row, because the way out
   * stays live while a write is in flight.
   */
  options: ReadonlyArray<{
    id: string
    label: string
    danger?: boolean
    muted?: boolean
    disabled?: boolean
  }>
}>()

const emit = defineEmits<{ pick: [id: string], close: [] }>()

useSheetDismiss(() => emit('close'))
</script>

<template>
  <div class="a-modal" @click.self="emit('close')">
    <div class="a-sheet" role="dialog" aria-modal="true" :aria-label="label">
      <p v-if="title" class="a-sheet-title">{{ title }}</p>

      <button
        v-for="option in options"
        :key="option.id"
        type="button"
        class="a-sheet-row"
        :class="{ danger: option.danger, muted: option.muted }"
        :disabled="option.disabled"
        @click="emit('pick', option.id)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.a-modal {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: var(--scrim);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.a-sheet {
  width: min(420px, 100%);
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  padding-bottom: calc(24px + env(safe-area-inset-bottom));
  border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
  background: var(--surface);
  box-shadow: var(--shadow-sheet);
  animation: a-sheet-in var(--dur-sheet) var(--ease-out-soft);
}

.a-sheet-title { margin: 4px 8px 8px; font-weight: 700; }

.a-sheet-row {
  min-height: 52px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-field);
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: var(--text-section);
  text-align: left;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}

.a-sheet-row:hover { background: var(--surface-2); }
.a-sheet-row:disabled { opacity: 0.45; cursor: default; }
.a-sheet-row.danger { color: var(--danger); }
.a-sheet-row.muted { color: var(--muted); }

/* DESIGN §5: a sheet slides 12 % up and fades in. Reduced motion collapses
   `--dur-sheet` to 1 ms, so the end state still applies and nothing moves. */
@keyframes a-sheet-in {
  from { opacity: 0; transform: translateY(12%); }
  to { opacity: 1; transform: translateY(0); }
}

/* A laptop gets the same object centred, which is what `UiSheet` does. */
@media (min-width: 1024px) {
  .a-modal { align-items: center; }

  .a-sheet {
    border-radius: var(--radius-panel);
    margin-bottom: 10vh;
    padding-bottom: 12px;
    box-shadow: var(--shadow-pop);
  }
}
</style>
