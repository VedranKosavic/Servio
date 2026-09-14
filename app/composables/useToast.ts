import { useTimeoutFn } from '@vueuse/core'

/**
 * The one-line confirmation at the top of a waiter screen — *Naplaćeno · Sto
 * 10* — and **the timer that takes it away again.**
 *
 * Every screen used to keep its own `toast` ref and set it from four or five
 * places, and exactly one of them (`/konobar/otpis`) ever cleared it. On the
 * other three the sentence simply stayed there for the rest of the shift,
 * sitting over the floor plan describing something that happened twenty minutes
 * ago. That is the bug this composable exists to make unrepeatable: there is no
 * way to set the message without also starting the timer.
 *
 * Saying something while a message is still up restarts the clock rather than
 * queueing, because the newest thing that happened is the one worth reading and
 * a waiter who taps four tables in a row wants the fourth answer.
 */
export function useToast(ms = 2200) {
  const toast = ref<string | null>(null)

  const { start, stop } = useTimeoutFn(() => { toast.value = null }, ms, { immediate: false })

  function say(message: string) {
    toast.value = message
    stop()
    start()
  }

  /** For a screen that is navigating away and does not want the message to follow. */
  function clear() {
    stop()
    toast.value = null
  }

  return { toast, say, clear }
}
