/**
 * *Novi artikal* on *Stanje šanka* — the menu half of the form.
 *
 * The rule worth pinning is the unit: a 1:1 `sells_stock_item_id` link takes one
 * base unit per sale, so it is offered for pieces only, and the body it builds
 * must carry the link or the new menu article would sell without touching stock.
 */
import { describe, expect, it } from 'vitest'
import { createProductBody } from '../../shared/schemas'
import { linkedProductBody, menuLinkError } from '../../app/utils/stanjeNovi'

const STOCK_ID = '3f9a1c22-0000-4000-8000-000000000001'
const CATEGORY_ID = '3f9a1c22-0000-4000-8000-000000000002'

describe('menuLinkError', () => {
  it('accepts a piece article with a category and a price', () => {
    expect(menuLinkError({ categoryId: CATEGORY_ID, priceFen: 350 }, 'kom')).toBeNull()
  })

  it('accepts 0,00 KM, which is a real price', () => {
    expect(menuLinkError({ categoryId: CATEGORY_ID, priceFen: 0 }, 'kom')).toBeNull()
  })

  it('refuses grams and millilitres, where one sale is not one unit', () => {
    expect(menuLinkError({ categoryId: CATEGORY_ID, priceFen: 350 }, 'g')).toMatch(/komad/)
    expect(menuLinkError({ categoryId: CATEGORY_ID, priceFen: 350 }, 'ml')).toMatch(/komad/)
  })

  it('asks for the category and the price', () => {
    expect(menuLinkError({ categoryId: '', priceFen: 350 }, 'kom')).toMatch(/kategoriju/)
    expect(menuLinkError({ categoryId: CATEGORY_ID, priceFen: null }, 'kom')).toMatch(/cijenu/)
  })
})

describe('linkedProductBody', () => {
  it('links the menu article to the stock article, and the server schema accepts it', () => {
    const body = linkedProductBody(STOCK_ID, '  Coca-Cola 0,25  ', { categoryId: CATEGORY_ID, priceFen: 350 })
    expect(body).toEqual({
      category_id: CATEGORY_ID,
      name: 'Coca-Cola 0,25',
      price_fen: 350,
      kind: 'simple',
      sells_stock_item_id: STOCK_ID,
    })
    expect(createProductBody.safeParse(body).success).toBe(true)
  })
})
