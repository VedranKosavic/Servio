/**
 * Polling that stops when nobody is looking.
 *
 * The bar's tablet sits on the counter all night. Asking the server for the
 * ticket list every 5 s is nothing; asking every 5 s from a phone locked in a
 * pocket is a flat battery. `document.visibilityState` is the browser's answer
 * to "is this tab actually on screen?" — VueUse's `useDocumentVisibility` turns
 * it into a ref, so the interval can pause when the screen goes off and fire an
 * immediate refresh the moment it comes back (the first thing the bartender
 * sees must never be a stale list).
 *
 * The poll also carries the sync chip: `online` is simply "did the last request
 * come back". A red chip is the screen telling the truth rather than showing
 * old tickets as if they were current.
 */
import { useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import type { ApiSideError } from '~/composables/useApi'

export function useVisiblePoll<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  /** Runs after every successful poll, with the fresh answer. */
  onData?: (value: T) => void,
) {
  // `shallowRef`, not `ref`: each poll replaces the whole answer, so there is
  // nothing to gain from making every nested object reactive.
  const data = shallowRef<T | null>(null)
  const online = ref(true)
  const error = ref<string | null>(null)
  /** False until the first answer (or first failure) — tells "empty" from "not asked yet". */
  const loaded = ref(false)

  // A slow request must not stack up behind the interval.
  let inFlight = false

  async function refresh(): Promise<void> {
    if (inFlight) return
    inFlight = true
    try {
      const value = await fetcher()
      data.value = value
      online.value = true
      error.value = null
      onData?.(value)
    } catch (err) {
      online.value = false
      error.value = (err as ApiSideError)?.message ?? 'Greška u vezi'
    } finally {
      inFlight = false
      loaded.value = true
    }
  }

  const { pause, resume } = useIntervalFn(refresh, intervalMs, { immediate: false })

  const visibility = useDocumentVisibility()
  watch(visibility, (state) => {
    if (state === 'visible') {
      void refresh()
      resume()
    } else {
      pause()
    }
  })

  // Client only: the session lives in localStorage, so these screens have
  // nothing to render on the server anyway.
  onMounted(() => {
    void refresh()
    resume()
  })

  return { data, online, error, loaded, refresh }
}
