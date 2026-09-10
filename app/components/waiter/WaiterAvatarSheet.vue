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
import type { ScreenMode } from '#shared/types'

const emit = defineEmits<{ close: [] }>()

useSheetDismiss(() => emit('close'))

const api = useApi()
const me = useMe()
const { blocked, blockedText } = useSync()
const wakeLock = useWakeLock()

const role = computed(() => me.user.value?.role ?? 'radnik')
const items = computed(() => WAITER_MENU.filter(item => item.roles.includes(role.value)))

/** Set while `POST /api/auth/mode` is in flight, and after it fails. */
const modeBusy = ref(false)
const modeError = ref<string | null>(null)

/** Where *Prebaci …* would take him: the screen he is **not** on. */
const otherMode = computed<ScreenMode>(() => (me.mode.value === 'sanker' ? 'konobar' : 'sanker'))

/**
 * The row says where it goes, not what it is: *Prebaci na šank* on the floor
 * and *Prebaci na konobara* behind the bar. Both screens are open to every
 * worker, so this is a move and not a promotion.
 */
const MODE_ROW: Record<ScreenMode, string> = {
  konobar: 'Prebaci na konobara',
  sanker: 'Prebaci na šank',
}

async function onLogout() {
  if (blocked.value) return
  emit('close')
  await me.logout()
}

/**
 * The switch, and the reason nobody signs out to change screens: the mode is a
 * field on the session. The route answers the whole `MeContext`, so `home` is
 * already the new screen by the time the navigation reads it.
 */
async function onMode() {
  if (modeBusy.value) return
  modeBusy.value = true
  modeError.value = null
  try {
    me.me.value = await api.setMode({ mode: otherMode.value })
    emit('close')
    await navigateTo(me.home.value)
  } catch (err) {
    modeError.value = apiErrorText(err)
  } finally {
    modeBusy.value = false
  }
}

function onItem(item: (typeof WAITER_MENU)[number]) {
  if (item.action === 'wakelock') {
    wakeLock.toggle()
    return
  }
  if (item.action === 'mode') {
    void onMode()
    return
  }
  if (item.action === 'logout') {
    void onLogout()
    return
  }
  if (!item.ready || !item.to) return
  emit('close')
  // Some rows are the same screen at two routes — see `toBartender`.
  // The šanker variant of a screen follows the *session's* mode now, not the
  // person's role: both screens are open to every worker and he may switch
  // between them without signing out.
  void navigateTo(me.mode.value === 'sanker' && item.toBartender ? item.toBartender : item.to)
}

function labelFor(item: (typeof WAITER_MENU)[number]): string {
  return item.action === 'mode' ? MODE_ROW[otherMode.value] : item.label
}

function disabledFor(item: (typeof WAITER_MENU)[number]): boolean {
  if (item.action === 'wakelock') return !wakeLock.supported.value
  if (item.action === 'logout') return blocked.value
  if (item.action === 'mode') return modeBusy.value
  return !item.ready
}

function noteFor(item: (typeof WAITER_MENU)[number]): string | null {
  if (item.action === 'wakelock') {
    if (!wakeLock.supported.value) return 'ovaj telefon ne podržava'
    return wakeLock.enabled.value ? 'uključeno' : 'isključeno'
  }
  if (item.action === 'logout') return blocked.value ? blockedText.value : null
  if (item.action === 'mode') return modeError.value
  return item.ready ? null : (item.soon ?? null)
}
</script>

<template>
  <!-- A tap anywhere outside closes the sheet; the sheet itself sits above it. -->
  <div class="sheet-scrim fixed inset-0 z-40" @click="emit('close')" />

  <div
    class="sheet-panel fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col pb-5"
    role="dialog"
    aria-label="Korisnik"
  >
    <div class="flex items-center gap-3 border-b border-line px-4 py-3">
      <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-body font-bold text-accent-ink">
        {{ me.user.value?.initials ?? '?' }}
      </span>
      <div class="grow">
        <div class="section-title">
          {{ me.user.value?.name ?? '' }}
        </div>
        <div class="text-label text-text-2">
          {{ me.device.value?.label ?? '' }}
        </div>
      </div>
      <button
        type="button"
        class="-mr-2 flex h-12 w-12 items-center justify-center rounded-control text-text-2"
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
        class="flex min-h-13 items-center gap-3 rounded-control px-3 py-2.5 text-left text-body"
        :class="disabledFor(item) ? 'text-muted' : 'text-text active:bg-surface-2'"
        :disabled="disabledFor(item)"
        @click="onItem(item)"
      >
        <span class="grow">{{ labelFor(item) }}</span>
        <span v-if="noteFor(item)" class="shrink-0 text-label text-text-2">
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
