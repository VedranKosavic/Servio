/**
 * The screen stays on — the Screen Wake Lock API.
 *
 * **What a wake lock is.** A browser can ask the phone not to dim and lock the
 * screen: `navigator.wakeLock.request('screen')` returns a sentinel, and the
 * screen stays on until that sentinel is released or the tab goes away. It is
 * the same thing a maps app does while you drive.
 *
 * Why it is here at all: a waiter builds a round with the phone on the bar,
 * looks up to hear the rest of the order, and the screen has locked. Unlocking
 * it costs him a PIN and the guest's patience.
 *
 * **Always on, and nobody chooses** (the owner, 17.09.2026): the staff layout
 * holds it for as long as the app is open, and the *Drži ekran upaljen* switch
 * in the avatar sheet is gone, battery rule and all.
 *
 * The lock is dropped by the browser itself whenever the tab is hidden, so
 * `visibilitychange` re-acquires it — without that, coming back from the camera
 * leaves a screen that dims again.
 */
import { useDocumentVisibility } from '@vueuse/core'

interface WakeLockSentinelLike { released: boolean, release: () => Promise<void> }

export function useWakeLock() {
  const active = ref(false)
  const supported = computed(() => import.meta.client && 'wakeLock' in navigator)

  let sentinel: WakeLockSentinelLike | null = null
  /** Does the screen currently want to stay on? Set by `hold(true/false)`. */
  let wanted = false

  async function acquire(): Promise<void> {
    if (!supported.value || !wanted) return
    if (sentinel && !sentinel.released) return
    try {
      const lock = navigator.wakeLock as unknown as {
        request: (type: 'screen') => Promise<WakeLockSentinelLike>
      }
      sentinel = await lock.request('screen')
      active.value = true
    } catch {
      // A denied or unsupported lock is not an error worth showing anybody.
      active.value = false
    }
  }

  async function release(): Promise<void> {
    active.value = false
    const current = sentinel
    sentinel = null
    if (!current || current.released) return
    try {
      await current.release()
    } catch {
      // Already gone. Nothing to do.
    }
  }

  function hold(want: boolean): void {
    wanted = want
    if (want) void acquire()
    else void release()
  }

  // The browser drops the lock whenever the tab is hidden; coming back has to
  // ask for it again or the screen quietly starts dimming.
  const visibility = useDocumentVisibility()
  watch(visibility, (state) => {
    if (state === 'visible') void acquire()
  })

  onBeforeUnmount(() => { void release() })

  return { active, supported, hold, release }
}
