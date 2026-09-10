<script setup lang="ts">
/**
 * *"Amar · Emirov telefon"* — the strip on a borrowed session (PHASE3 §3, WP4).
 *
 * A waiter whose battery died PINs into a colleague's phone and says so
 * (`borrow: true`); the server gives him two hours instead of fourteen and
 * stamps `borrowed` on the session. From then until he logs out, every screen
 * carries this line.
 *
 * It is rendered from the dark layout rather than from a header, because it has
 * to be true on *every* `/konobar` and `/sanker` screen for the *whole* session
 * — a round locked on Emir's phone under Amar's name is exactly the thing that
 * must be visible while it is happening, not in the morning. It renders nothing
 * at all on an ordinary session.
 */
const me = useMe()
</script>

<template>
  <ClientOnly>
    <div
      v-if="me.borrowed.value"
      class="-mx-4 flex items-center gap-2 border-b border-line bg-warn-soft px-4 py-1.5 text-[15px] text-warn"
      role="status"
    >
      <svg
        class="shrink-0"
        width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
      >
        <path d="M16 3h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2M12 17h.01" />
      </svg>
      <span class="truncate font-semibold">{{ me.identityLabel.value }}</span>
      <span class="shrink-0 text-text-2">posuđen telefon</span>
    </div>
  </ClientOnly>
</template>
