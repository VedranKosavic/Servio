/**
 * Repeat a job while the screen is actually being looked at.
 *
 * The floor plan has to stay honest without a live connection, so it simply
 * re-asks the server every 15 s. Two rules keep that cheap: the timer only runs
 * while the tab is visible (a phone in an apron pocket polls nothing), and
 * coming back to the screen refreshes at once instead of waiting out the
 * interval — the waiter should never look at a stale room.
 *
 * `ok` is the outcome of the LAST attempt. That single boolean is what the
 * "Sinhronizovano" / "Nema veze" chip in the header renders; a failed poll does
 * not clear the data on screen, it only stops claiming the data is current.
 */
export function usePolling(job: () => Promise<unknown>, intervalMs = 15_000) {
  /** Did the last attempt reach the server? Starts optimistic. */
  const ok = ref(true)
  const pending = ref(false)

  async function run() {
    // One request at a time: a slow network must not queue up five polls.
    if (pending.value) return
    pending.value = true
    try {
      await job()
      ok.value = true
    } catch {
      ok.value = false
    } finally {
      pending.value = false
    }
  }

  // VueUse's timer instead of a hand-rolled setInterval: it gives pause/resume
  // and clears itself when the component is unmounted. `immediate: false` means
  // "do not start the clock yet" — we start it on mount, which never runs on
  // the server.
  const { pause, resume } = useIntervalFn(run, intervalMs, { immediate: false })

  const visibility = useDocumentVisibility()
  watch(visibility, (state) => {
    if (state === 'visible') {
      void run()
      resume()
    } else {
      pause()
    }
  })

  onMounted(() => {
    void run()
    resume()
  })

  return { ok, pending, run }
}
