/**
 * *Drži ekran upaljen* — the Screen Wake Lock API.
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
 * Three rules, all of them about not being rude to the battery:
 *
 *   - Held **only while a draft has lines** (S3 and S4), released on leaving
 *     the screen and on locking the round.
 *   - Skipped under 20 % battery, where the Battery API exists to say so.
 *   - Off entirely when the waiter switched it off in the avatar sheet.
 *
 * The lock is also dropped by the browser itself whenever the tab is hidden, so
 * `visibilitychange` re-acquires it — without that, coming back from the camera
 * leaves a screen that dims again.
 */
import { useDocumentVisibility, useLocalStorage } from '@vueuse/core'

/** Below this, the screen is allowed to sleep whatever the setting says. */
const LOW_BATTERY = 0.2

interface WakeLockSentinelLike { released: boolean, release: () => Promise<void> }

export function useWakeLock() {
  /** The waiter's own switch, remembered per phone. On by default. */
  const enabled = useLocalStorage('sank:ekran-upaljen', true)
  const active = ref(false)
  /** Whether the phone has the API at all — the sheet greys the row without it. */
  const supported = computed(() => import.meta.client && 'wakeLock' in navigator)

  let sentinel: WakeLockSentinelLike | null = null
  /** Does the screen currently want to stay on? Set by `hold(true/false)`. */
  let wanted = false

  async function batteryIsLow(): Promise<boolean> {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number, charging: boolean }> }
    if (!nav.getBattery) return false
    try {
      const battery = await nav.getBattery()
      return !battery.charging && battery.level < LOW_BATTERY
    } catch {
      return false
    }
  }

  async function acquire(): Promise<void> {
    if (!supported.value || !enabled.value || !wanted) return
    if (sentinel && !sentinel.released) return
    if (await batteryIsLow()) return
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

  /** The one call a screen makes: `hold(lines.length > 0)`. */
  function hold(want: boolean): void {
    wanted = want
    if (want) void acquire()
    else void release()
  }

  function toggle(next?: boolean): void {
    enabled.value = next ?? !enabled.value
    if (enabled.value) void acquire()
    else void release()
  }

  // The browser drops the lock whenever the tab is hidden; coming back has to
  // ask for it again or the screen quietly starts dimming.
  const visibility = useDocumentVisibility()
  watch(visibility, (state) => {
    if (state === 'visible') void acquire()
  })

  onBeforeUnmount(() => { void release() })

  return { enabled, active, supported, hold, toggle, release }
}
