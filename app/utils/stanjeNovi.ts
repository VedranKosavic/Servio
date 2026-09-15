/**
 * *Novi artikal* on *Stanje šanka*: one form that puts an article on the shelf
 * and, when it is sold as it is, on the menu too.
 *
 * The menu article is created with `sells_stock_item_id` pointing at the new
 * stock article — the 1:1 link `resolveStock()` in `server/services/orders.ts`
 * reads when a round is locked, so every sale takes `qty` base units off the
 * shelf with no *normativ* to set up. That is only right for an article counted
 * in pieces: a 1:1 link on a gram or millilitre article would take one gram per
 * sale, so those still go through the *Normativ* on *Meni*.
 */
import type { CreateProductBody } from '#shared/schemas'

export interface MenuLink {
  categoryId: string
  /** Feninga; `null` while nothing has been typed. 0 is a real price. */
  priceFen: number | null
}

/** The Bosnian reason the menu half cannot be saved, or `null` when it can. */
export function menuLinkError(link: MenuLink, baseUnit: 'kom' | 'g' | 'ml'): string | null {
  if (baseUnit !== 'kom') {
    return 'Na meni se direktno veže samo roba na komad. Za grame i mililitre isključi „Prodaje se na meniju“ i podesi normativ na Meniju.'
  }
  if (!link.categoryId) return 'Izaberi kategoriju na meniju.'
  if (link.priceFen === null || link.priceFen < 0) return 'Upiši cijenu na meniju.'
  return null
}

/** The `POST /api/admin/products` body for the menu article that sells this stock article. */
export function linkedProductBody(stockItemId: string, name: string, link: MenuLink): CreateProductBody {
  return {
    category_id: link.categoryId,
    name: name.trim().slice(0, 60),
    price_fen: link.priceFen ?? 0,
    kind: 'simple',
    sells_stock_item_id: stockItemId,
  }
}
