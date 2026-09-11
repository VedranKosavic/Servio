/**
 * A new build is on the phone. When is it allowed to take over?
 *
 * **How a service worker updates, in five lines.** Every navigation makes the
 * browser re-fetch `sw.js` and compare it byte for byte with the one it has.
 * A different file is installed as a second worker — and then it *waits*, with
 * the old one still answering every request, until something calls
 * `skipWaiting()`. `registerType: 'prompt'` in `nuxt.config.ts` is what keeps
 * that call out of the framework's hands: a build must never swap itself in
 * under a waiter who is four taps into a round.
 *
 * The cost of that rule was a phone that never swapped at all. *Nova verzija*
 * is mounted on two screens (`WaiterUpdatePrompt`), and a tablet parked on the
 * lock screen, or an owner who only ever opens `/admin`, never sees it — so
 * the waiting worker waits for weeks and the old bundle keeps being served
 * against a server that has moved on. That is the shape of the bug this file
 * exists for: a login screen from an older build, posting a body the API no
 * longer accepts, reported to the waiter as *"PIN nije prepoznat"*.
 *
 * So there are two ways in, and they share one definition of *waiting*:
 *
 *   `apply()`         the tap on *Nova verzija · Osvježi*, between rounds.
 *   `applyWhenIdle()` no tap at all, on the lock screen — because that screen
 *                     is the definition of a safe moment. Nobody is mid-round
 *                     on it, and neither the drafts nor the outbox live in
 *                     memory: both are in IndexedDB and come back after the
 *                     reload exactly as they were (`stores/cart.ts`,
 *                     `stores/outbox.ts`).
 *
 * `$pwa` is what `@vite-pwa/nuxt` injects, and it is **absent under
 * `npm run dev`** — `devOptions.enabled` is false there, because a worker
 * caching a Vite module graph that changes on every save is an afternoon of
 * phantom bugs. Every read below is therefore optional, and every function is a
 * no-op without it.
 */

interface PwaLike {
  needRefresh: boolean
  updateServiceWorker: (reload?: boolean) => Promise<void>
}

/**
 * The guard against a reload loop, and it guards the **automatic** path only.
 *
 * `applyWhenIdle()` reloads the page, and the page it reloads into runs
 * `applyWhenIdle()` again. That is fine when the swap worked — there is no
 * waiting worker left and `needRefresh` is false — and an endless loop when it
 * did not (a worker that fails to activate keeps the flag up). One mark per
 * tab, with the clock on it, means the second automatic attempt is refused and
 * the person is left looking at a working lock screen on an old bundle rather
 * than at a page that reloads forever.
 *
 * A **tap** on *Osvježi* is never refused: a person pressing a button is not a
 * loop, and telling him nothing happened because a timer says so would be the
 * worse failure.
 */
const APPLIED_KEY = 'sank:sw-applied-at'
const RETRY_AFTER_MS = 60_000

function markedRecently(): boolean {
  try {
    const at = Number(sessionStorage.getItem(APPLIED_KEY) ?? 0)
    return Number.isFinite(at) && Date.now() - at < RETRY_AFTER_MS
  } catch {
    // Private mode, or storage refused. Without a mark we cannot promise not to
    // loop, so the automatic path stays shut and the tap still works.
    return true
  }
}

function mark(): void {
  try {
    sessionStorage.setItem(APPLIED_KEY, String(Date.now()))
  } catch {
    // Nothing to remember is handled above.
  }
}

export function useAppUpdate() {
  const { $pwa } = useNuxtApp() as unknown as { $pwa?: PwaLike }

  /** A build is installed and waiting for permission to take over. */
  const needRefresh = computed(() => $pwa?.needRefresh === true)

  /** Hand over to the waiting build and reload the page onto it. */
  async function apply(): Promise<void> {
    if (!$pwa?.needRefresh) return
    mark()
    await $pwa.updateServiceWorker(true)
  }

  /**
   * The same thing without a tap, for a screen where there is nothing to lose.
   *
   * It **watches** rather than looking once, and that is the whole difference
   * between fixing this and appearing to. A reload is what makes the browser
   * re-fetch `sw.js` and notice that a new build exists — but installing it
   * takes a moment, so at `onMounted` there is usually nothing waiting yet. A
   * one-shot check would find `needRefresh` false on the very load that
   * discovered the update, and the swap would need a *second* reload: the
   * waiter reloads, nothing changes, and he concludes the app is broken rather
   * than old. The watcher fires the instant the worker reports in, which is a
   * second or two into the same visit.
   *
   * Called from a screen's `onMounted`, so the watcher belongs to that
   * component and stops when the person leaves the lock screen. It fires at
   * most once: `apply()` reloads the page, and the mark below refuses a second
   * attempt within the minute.
   */
  function applyWhenIdle(): void {
    if (!import.meta.client || markedRecently()) return

    // The already-waiting case is handled *before* the watcher and not by
    // `{ immediate: true }`, which would run the callback synchronously inside
    // the `watch()` call — while `stop` is still in its temporal dead zone, so
    // `stop()` would throw a ReferenceError out of the lock screen's
    // `onMounted` and leave the pad blank. Somebody tapping *Odjavi se* on a
    // phone that already has a build waiting is the ordinary way into that.
    if (needRefresh.value) {
      void apply()
      return
    }

    const stop = watch(needRefresh, (waiting) => {
      if (!waiting) return
      stop()
      void apply()
    })
  }

  return { needRefresh, apply, applyWhenIdle }
}
