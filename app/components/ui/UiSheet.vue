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

  if (event.shiftKey && (active === first || !panel.value?.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(() => props.open, async (open) => {
  if (!import.meta.client) return
  document.body.style.overflow = open ? 'hidden' : ''
  if (!open) return
  await nextTick()
  focusables()[0]?.focus()
}, { immediate: true })

onBeforeUnmount(() => {
  if (import.meta.client) document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="a-sheet-root" @keydown="onKeydown">
      <div class="a-scrim" @click="emit('close')" />
      <div
        ref="panel"
        class="a-sheet"
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
}

.a-sheet {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px 16px 0 0;
  width: 100%;
  max-height: 88dvh;
  display: flex;
  flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom);
}

.a-sheet-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
}

.a-sheet-head h2 { margin: 0; font-size: 17px; font-weight: 600; }

.a-sheet-x {
  margin-left: auto;
  width: 44px;
  height: 44px;
  border: 0;
  background: transparent;
  color: var(--ink-2);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.a-sheet-body {
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.a-sheet-foot {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 12px 16px 16px;
  border-top: 1px solid var(--line);
}

/* A laptop gets a centred dialog; the phone keeps the sheet at the bottom,
   where a thumb reaches it. */
@media (min-width: 1024px) {
  .a-sheet-root { align-items: center; }
  .a-sheet {
    width: min(560px, 92vw);
    border-radius: 14px;
    max-height: 82dvh;
  }
}
</style>
