<script setup lang="ts">
/**
 * One thing at a time: a bottom sheet on a phone, a centred dialog on a laptop.
 *
 * Three behaviours that are easy to forget and hard to add later:
 *
 * - **Esc closes it**, because a keyboard user has no scrim to click.
 * - **Focus is trapped inside** while it is open — Tab from the last control
 *   goes back to the first instead of walking the page behind the scrim.
 * - **The page behind does not scroll**, so a phone does not lose its place.
 */
const props = withDefaults(defineProps<{
  open: boolean
  title: string
  /** The one primary action's label. Omit for a sheet that only shows things. */
  action?: string
  pending?: boolean
  /**
   * Bump this when the panel's content is replaced while the sheet stays open —
   * a form that becomes a confirmation — so focus moves into the new content
   * instead of falling out of the dialog.
   */
  contentKey?: string | number
}>(), { pending: false })

const emit = defineEmits<{ close: [], confirm: [] }>()

const panel = ref<HTMLElement | null>(null)

/** Everything focusable inside the panel, in tab order. */
function focusables(): HTMLElement[] {
  if (!panel.value) return []
  return Array.from(panel.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ))
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key !== 'Tab') return

  const items = focusables()
  if (items.length === 0) return
  const first = items[0]!
  const last = items[items.length - 1]!
  const active = document.activeElement
  const inside = !!panel.value?.contains(active)

  if (event.shiftKey && (active === first || !inside)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || !inside)) {
    event.preventDefault()
    first.focus()
  }
}

/**
 * Esc is listened for on the **document**, not on the root element.
 *
 * Bound to the element, it only fires while focus is inside the sheet — and the
 * moment a sheet swaps its content (a form that becomes "PIN je postavljen ·
 * Zatvori") the focused control is gone, `document.activeElement` falls back to
 * `<body>`, and Esc stops working with the scrim still covering the page. The
 * Tab trap moved with it for the same reason.
 */
useEventListener(
  // A getter, because `document` does not exist during the server render.
  () => (import.meta.client ? document : null),
  'keydown',
  (event: KeyboardEvent) => { if (props.open) onKeydown(event) },
)

/**
 * Focus follows the content, not just the opening.
 *
 * `contentKey` is how a caller says "this is a different panel now" — the same
 * sheet showing a success state instead of a form. Without it the focus trap
 * has nothing inside it to trap.
 */
watch(() => [props.open, props.contentKey], async ([open]) => {
  if (!import.meta.client) return
  document.body.style.overflow = open ? 'hidden' : ''
  if (!open) return
  await nextTick()
  ;(focusables()[0] ?? panel.value)?.focus()
}, { immediate: true })

onBeforeUnmount(() => {
  if (import.meta.client) document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="a-sheet-root">
      <div class="a-scrim" @click="emit('close')" />
      <div
        ref="panel"
        class="a-sheet"
        tabindex="-1"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <header class="a-sheet-head">
          <h2>{{ title }}</h2>
          <button type="button" class="a-sheet-x" aria-label="Zatvori" @click="emit('close')">
            <svg
              width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
            ><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div class="a-sheet-body"><slot /></div>

        <footer v-if="action || $slots.footer" class="a-sheet-foot">
          <slot name="footer">
            <UiButton variant="ghost" @click="emit('close')">Odustani</UiButton>
            <UiButton variant="primary" :pending="pending" @click="emit('confirm')">
              {{ action }}
            </UiButton>
          </slot>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.a-sheet-root {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.a-scrim {
  position: absolute;
  inset: 0;
  background: var(--scrim);
  animation: a-fade var(--dur-base) var(--ease-standard);
}

.a-sheet {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
  box-shadow: var(--shadow-sheet);
  width: 100%;
  max-height: 88dvh;
  display: flex;
  flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom);
  animation: a-sheet-up var(--dur-sheet) var(--ease-out-soft);
}

.a-sheet-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--line-soft);
}

.a-sheet-head h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-section);
  line-height: 1.3;
  letter-spacing: -0.01em;
  font-weight: 700;
}

.a-sheet-x {
  margin-left: auto;
  margin-right: -8px;
  width: 44px;
  height: 44px;
  border: 0;
  background: transparent;
  color: var(--muted);
  border-radius: var(--radius-field);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}

.a-sheet-x:hover { background: var(--surface-2); color: var(--ink); }

.a-sheet-body {
  padding: 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-size: var(--text-body);
}

.a-sheet-foot {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 14px 20px 18px;
  border-top: 1px solid var(--line-soft);
  background: var(--surface-3);
}

/* The vocabulary is three things: a sheet slides 12 % up and fades in, a tap
   scales the surface, a state change cross-fades. Both durations are tokens,
   so `prefers-reduced-motion` collapses them to 1 ms for free. */
@keyframes a-sheet-up {
  from { transform: translateY(12%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@keyframes a-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* A laptop gets a centred dialog; the phone keeps the sheet at the bottom,
   where a thumb reaches it. */
@media (min-width: 1024px) {
  .a-sheet-root { align-items: center; }
  .a-sheet {
    width: min(560px, 92vw);
    border-radius: var(--radius-panel);
    box-shadow: var(--shadow-pop);
    max-height: 82dvh;
  }
  .a-sheet-foot { border-radius: 0 0 var(--radius-panel) var(--radius-panel); }
}
</style>
