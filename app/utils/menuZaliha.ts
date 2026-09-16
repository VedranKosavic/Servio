/**
 * What a menu article takes off *Stanje šanka* when it is sold — the four ways
 * the owner described (16.09.2026), as one choice on the article.
 *
 *   komad    one piece of one article on the shelf (`sells_stock_item_id`):
 *            a Coca-Cola is a bottle, a čaj is a bag
 *   kafa     one dose of a coffee article (`coffee_stock_item_id`), the dose
 *            being *Gramaža → grama po kafi*
 *   nargila  `kind: 'shisha'`: the waiter picks the aromas and one bowl's
 *            *Gramaža → grama po luli* is split across them
 *   nista    nothing — *Limunada*, *Cijeđeni sok*: sold, never counted
 *
 * The server keeps the three columns it always had; this file is only the
 * mapping between them and the one word on the screen, so the new-article
 * sheet, the phone's sheet and the laptop's row cannot disagree about it.
 */
import type { ProductAdmin, StockItemAdmin } from '#shared/types'

export type ZalihaMode = 'komad' | 'kafa' | 'nargila' | 'nista'

export const ZALIHA_MODE_OPTIONS: ReadonlyArray<{ value: ZalihaMode, label: string }> = [
  { value: 'komad', label: 'Po komadu' },
  { value: 'kafa', label: 'Troši kafu' },
  { value: 'nargila', label: 'Nargila' },
  { value: 'nista', label: 'Ne oduzima' },
]

type ProductDeduct = Pick<ProductAdmin, 'kind' | 'sells_stock_item_id' | 'coffee_stock_item_id'>

export function zalihaModeOf(product: ProductDeduct): ZalihaMode {
  if (product.kind === 'shisha') return 'nargila'
  if (product.coffee_stock_item_id) return 'kafa'
  if (product.sells_stock_item_id) return 'komad'
  return 'nista'
}

/** The article the mode points at, when it points at one. */
export function zalihaArticleOf(product: ProductDeduct): string | null {
  if (product.kind === 'shisha') return null
  return product.coffee_stock_item_id ?? product.sells_stock_item_id ?? null
}

/** Which shelf articles a mode may point at: pieces for *komad*, coffee for *kafa*. */
export function articlesFor(mode: ZalihaMode, items: StockItemAdmin[]): StockItemAdmin[] {
  if (mode === 'komad') return items.filter(item => item.active && item.base_unit === 'kom')
  if (mode === 'kafa') return items.filter(item => item.active && item.kind === 'kafa')
  return []
}

/**
 * The three columns for a choice — every one of them set, so switching a
 * *Troši kafu* article to *Po komadu* also clears the coffee it used to take.
 */
export function zalihaPatch(
  mode: ZalihaMode, articleId: string | null,
): Pick<ProductAdmin, 'kind' | 'sells_stock_item_id' | 'coffee_stock_item_id'> {
  return {
    kind: mode === 'nargila' ? 'shisha' : 'simple',
    sells_stock_item_id: mode === 'komad' ? articleId : null,
    coffee_stock_item_id: mode === 'kafa' ? articleId : null,
  }
}

/** Is the choice complete? *Po komadu* and *Troši kafu* need their article. */
export function zalihaReady(mode: ZalihaMode, articleId: string | null): boolean {
  return mode === 'nargila' || mode === 'nista' || !!articleId
}

/** One line under the article: "Po komadu · Coca-Cola", "Troši kafu · Kafa u zrnu". */
export function zalihaSummary(product: ProductDeduct, items: StockItemAdmin[]): string {
  const mode = zalihaModeOf(product)
  const nameOf = (id: string | null) => items.find(item => item.id === id)?.name ?? 'nepoznat artikal'
  switch (mode) {
    case 'komad': return `Po komadu · ${nameOf(product.sells_stock_item_id)}`
    case 'kafa': return `Troši kafu · ${nameOf(product.coffee_stock_item_id)}`
    case 'nargila': return 'Nargila · okusi po gramaži'
    default: return 'Ne oduzima sa stanja'
  }
}
