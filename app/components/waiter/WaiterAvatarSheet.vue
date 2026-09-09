<script setup lang="ts">
/**
 * Everything that is not a table: the sheet behind the initials in the header.
 *
 * Its rows come from `app/utils/waiterMenu.ts` and are all listed from day one,
 * disabled until their screen exists — see that file for why.
 *
 * The row that matters here is **Odjavi se**, and it is the one place in the
 * app where the outbox says no. Logging out on a shared tablet while money is
 * still queued would strand that money on a session nobody is holding: the next
 * person's flush would post it under *his* name, or nobody would flush it at
 * all. So the row greys out and says how many rounds are waiting, and the queue
 * empties itself the moment there is a network.
 */
const emit = defineEmits<{ close: [] }>()

const me = useMe()
const { blocked, blockedText } = useSync()
const wakeLock = useWakeLock()

const role = computed(() => me.user.value?.role ?? 'waiter')
const items = computed(() => WAITER_MENU.filter(item => item.roles.includes(role.value)))

async function onLogout() {
  if (blocked.value) return
  emit('close')
  await me.logout()
}

function onItem(item: (typeof WAITER_MENU)[number]) {
  if (item.action === 'wakelock') {
    wakeLock.toggle()
    return
  }
  if (item.action === 'logout') {
    void onLogout()
    return
  }
  if (!item.ready || !item.to) return
  emit('close')
  void navigateTo(item.to)
}

function disabledFor(item: (typeof WAITER_MENU)[number]): boolean {
  if (item.action === 'wakelock') return !wakeLock.supported.value
  if (item.action === 'logout') return blocked.value
  return !item.ready
}

function noteFor(item: (typeof WAITER_MENU)[number]): string | null {
  if (item.action === 'wakelock') {
    if (!wakeLock.supported.value) return 'ovaj telefon ne podržava'
    return wakeLock.enabled.value ? 'uključeno' : 'isključeno'
  }
  if (item.action === 'logout') return blocked.value ? blockedText.value : null
  return item.ready ? null : (item.soon ?? null)
}
</script>

<template>
  <!-- A tap anywhere outside closes the sheet; the sheet itself sits above it. -->
  <div class="fixed inset-0 z-40 bg-black/60" @click="emit('close')" />

  <div
    class="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl border-t border-line bg-surface pb-5"
    role="dialog"
    aria-label="Korisnik"
  >
    <div class="flex items-center gap-3 border-b border-line px-4 py-3">
      <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-base font-bold text-accent-ink">
        {{ me.user.value?.initials ?? '?' }}
      </span>
      <div class="grow">
        <div class="text-lg font-semibold">
          {{ me.user.value?.name ?? '' }}
        </div>
        <div class="text-sm text-text-2">
          {{ me.device.value?.label ?? '' }}
        </div>
      </div>
      <button
        type="button"
        class="-mr-2 flex h-12 w-12 items-center justify-center rounded-xl text-text-2"
        aria-label="Zatvori"
        @click="emit('close')"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div class="flex flex-col overflow-y-auto p-2">
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        class="flex min-h-13 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[17px]"
        :class="disabledFor(item) ? 'text-muted' : 'text-text active:bg-surface-2'"
        :disabled="disabledFor(item)"
        @click="onItem(item)"
      >
        <span class="grow">{{ item.label }}</span>
        <span v-if="noteFor(item)" class="shrink-0 text-sm text-text-2">
          {{ noteFor(item) }}
        </span>
        <span
          v-if="item.action === 'wakelock' && wakeLock.supported.value"
          class="h-6 w-11 shrink-0 rounded-full border border-line p-0.5"
          :class="wakeLock.enabled.value ? 'bg-accent' : 'bg-surface-2'"
        >
          <span
            class="block h-5 w-5 rounded-full bg-text transition-transform"
            :class="wakeLock.enabled.value ? 'translate-x-5' : ''"
          />
        </span>
      </button>
    </div>
  </div>
</template>
