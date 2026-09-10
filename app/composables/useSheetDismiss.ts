/**
 * The two behaviours every bottom sheet in the app owes the person using it:
 * **Escape closes it**, and **the page behind it stops scrolling** while it is
 * open.
 *
 * `/admin`'s `UiSheet` has always done both. The seventeen dark sheets on
 * `/konobar` and `/sanker` each hand-rolled their own scrim and panel and none
 * of them did either — so a sheet on the dashboard and a sheet on the floor
 * were the same object with different manners. This is that behaviour in one
 * place, so the answer stops depending on which screen you opened it from.
 *
 * **Why a composable and not a wrapper component.** These sheets are mounted by
 * a `v-if` in their parent and each one owns a very different body — a keypad,
 * a price editor, a product grid. Wrapping them all would mean rewriting
 * seventeen templates; a composable gives them the shared *behaviour* while
 * `.sheet-scrim` / `.sheet-panel` in `main.css` give them the shared *chrome*,
 * and neither has to touch what is inside.
 *
 * Because the sheet is mounted only while it is open, "on mount" and "while
 * open" are the same moment — there is no `open` flag to watch.
 *
 * The scroll lock counts: two stacked sheets (a PIN sheet over a storno sheet)
 * must not have the inner one restore scrolling when it closes and leave the
 * outer one sitting over a scrolling page.
 */

/** How many sheets are open right now. The lock lifts when the last one goes. */
let depth = 0

export function useSheetDismiss(close: () => void) {
  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    close()
  }

  onMounted(() => {
    document.addEventListener('keydown', onKeydown)
    depth += 1
    document.body.style.overflow = 'hidden'
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', onKeydown)
    depth = Math.max(0, depth - 1)
    if (depth === 0) document.body.style.overflow = ''
  })
}
