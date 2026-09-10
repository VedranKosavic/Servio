<script setup lang="ts">
/**
 * The chrome every bottom sheet in the order flow draws: the scrim, the panel,
 * the grab handle, and the one set of layout values they all have to agree on.
 *
 * DESIGN §10 folded the sheet's *material* into `.sheet-panel` and its
 * *behaviour* into `useSheetDismiss`, but left the layout around them to each
 * caller — and five copies of the same two-hundred-character class string drift
 * the moment one is edited on its own. They had: `OrderZarSheet` was capped at
 * `85dvh` while its four siblings sat at `92dvh`, which is the same "three
 * different max heights" §10 folded the seventeen dark sheets together to stop.
 * This is the third piece, so there is one place to change and nothing left to
 * keep in step.
 *
 * It is a primitive built inside the screen's own components folder, which is
 * what §10 allows when the system lacks one — `/admin` has `UiSheet` for the
 * same job in the other material, and a shared component would have to carry
 * both, which is how two shapes for one job start.
 *
 * `scroll` is off for a sheet short enough never to need it
 * (`OrderLockedLineSheet`): a scroller that cannot scroll still swallows a drag.
 *
 * Behaviour stays with the caller. `useSheetDismiss` wants the sheet's own
 * `close`, and a wrapper that called it too would bind Escape twice.
 */
withDefaults(defineProps<{
  /** What the dialog is called, for a screen reader. */
  label: string
  /** Cap the panel and let it scroll. Off for a sheet that is always short. */
  scroll?: boolean
}>(), { scroll: true })

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <div class="fixed inset-0 z-50">
    <div class="sheet-scrim" @click="emit('close')" />

    <div
      class="sheet-panel absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3"
      :class="scroll ? 'max-h-[92dvh] overflow-y-auto' : ''"
      role="dialog"
      :aria-label="label"
    >
      <span class="mx-auto h-1 w-10 shrink-0 rounded-full bg-line" />

      <slot />
    </div>
  </div>
</template>
