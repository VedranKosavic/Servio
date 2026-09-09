/**
 * *Meni & Postavke* — the catalogue, the floor plan, the staff and the venue's
 * settings (`docs/BACKEND.md` §6.10, §7 *admin*).
 *
 * Three rules shape every function below, and they are the reason this file is
 * long and repetitive rather than clever:
 *
 *   **Admin never deletes.** `active = 0`, `available = 0`, `revoked_at`. A
 *   product that disappeared from the menu in March still has to render the
 *   `order_lines` sold in February, and a foreign key that no longer resolves is
 *   a report that silently loses a category.
 *
 *   **Every write is one transaction with a `log()` and a `bump()` in it.** The
 *   Dnevnik entry and the sync row are written *inside* the transaction that
 *   changes the row, so a write that rolls back cannot leave the owner reading
 *   about a price change that never happened, and cannot tell a phone to refetch
 *   a menu that did not move. The bus emit comes *after* the transaction returns
 *   (`server/utils/bus.ts` says why never before).
 *
 *   **A price change is history, not an edit.** `updateProduct` closes the open
 *   `price_history` row and opens a new one; it never touches an `order_lines`
 *   row, because those carry the price the guest was actually charged
 *   (`unit_price_fen` is snapshotted at lock). Tonight's pazar does not move
 *   because the owner corrected a price at midnight.
 */
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { badRequest, conflict, notFound, unprocessable } from '../utils/errors'
import { newId, nowIso } from '../utils/ids'
import { hashSecret } from '../utils/password'
import { emitChange } from '../utils/bus'
import { bump, getSettings, log, unitCost } from './contracts'
import { maxSeq } from './changes'
import type { Actor, Db, Queryable, Tx } from './types'
import type {
  CategoryAdmin, ChangeEntity, PinResetResult, ProductAdmin, RecipeLine,
  StockItemAdmin, TableAdmin, UserAdmin,
} from '#shared/types'
import type {
  CreateCategoryBody, CreateProductBody, CreateStockItemBody, CreateTableBody,
  CreateUserBody, SetRecipeBody, UpdateCategoryBody, UpdateProductBody,
  UpdateStockItemBody, UpdateTableBody, UpdateUserBody,
} from '#shared/schemas'
import { SETTINGS_LABELS, mergeSettings, type Settings, type SettingsPatch } from '#shared/settings'

// ===========================================================================
// Small shared pieces
// ===========================================================================

/** SQLite has no boolean. One place that says so, instead of `? 1 : 0` everywhere. */
const flag = (value: boolean | undefined, fallback: number): number =>
  value === undefined ? fallback : (value ? 1 : 0)

const isOn = (value: number): boolean => value === 1

/**
 * A PATCH with no keys.
 *
 * Refused rather than treated as a no-op: it would still open a transaction,
 * still write a Dnevnik entry saying nothing changed, and still tell every
 * phone in the building to refetch the menu.
 */
function requireSomething(patch: object): void {
  if (Object.keys(patch).length === 0) {
    throw badRequest('EMPTY_PATCH', 'a patch with no fields changes nothing')
  }
}

/**
 * The Bosnian summary of what a patch touched — the `{what}` in "Artikal
 * promijenjen · Kafa · **naziv, sortiranje**".
 *
 * Only the fields that actually moved are named, so re-saving a form with one
 * character changed does not produce an entry claiming all eleven fields did.
 * A *value* never goes in here (that is what `price_changed` is for); this is a
 * list of field labels, which keeps `log.test.ts`'s "no body matches
 * /hash|token|email|chat_id/" true by construction.
 */
function changedLabels(
  before: object,
  patch: object,
  labels: Record<string, string>,
  map: Record<string, string>,
): string[] {
  const row = before as Record<string, unknown>
  const next = patch as Record<string, unknown>
  const out: string[] = []
  for (const key of Object.keys(next)) {
    const column = map[key]
    if (!column) continue
    if (same(row[column], next[key])) continue
    out.push(labels[key] ?? key)
  }
  return out
}

/** `null` and `undefined` are the same absence here; everything else compares by value. */
function same(a: unknown, b: unknown): boolean {
  const left = a ?? null
  const right = b ?? null
  if (typeof left === 'number' && typeof right === 'boolean') return isOn(left) === right
  if (Array.isArray(left) || Array.isArray(right)) return JSON.stringify(left) === JSON.stringify(right)
  return left === right
}

/** One `changes` row plus the post-commit bus emit, spelled once. */
function announce(db: Db, venueId: string, entity: ChangeEntity, entityId?: string): void {
  emitChange(venueId, { seq: maxSeq(db, venueId), entity, entityId })
}

// ===========================================================================
// Products
// ===========================================================================

const PRODUCT_LABELS: Record<string, string> = {
  category_id: 'kategorija',
  name: 'naziv',
  short_name: 'kratki naziv',
  search_aliases: 'pretraga',
  price_fen: 'cijena',
  kind: 'vrsta',
  sells_stock_item_id: 'roba',
  shisha_grams: 'grama po luli',
  coal_pcs: 'žara po luli',
  staff_drink_allowed: 'piće za osoblje',
  is_favourite: 'omiljeno',
  sort: 'sortiranje',
  active: 'aktivan',
}

const PRODUCT_COLUMNS: Record<string, string> = {
  category_id: 'categoryId',
  name: 'name',
  short_name: 'shortName',
  search_aliases: 'searchAliases',
  price_fen: 'priceFen',
  kind: 'kind',
  sells_stock_item_id: 'sellsStockItemId',
  shisha_grams: 'shishaGrams',
  coal_pcs: 'coalPcs',
  staff_drink_allowed: 'staffDrinkAllowed',
  is_favourite: 'isFavourite',
  sort: 'sort',
  active: 'active',
}

export function listProducts(q: Queryable, venueId: string): ProductAdmin[] {
  const rows = q.select({ product: schema.products, categoryName: schema.categories.name })
    .from(schema.products)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.products.categoryId))
    .where(eq(schema.products.venueId, venueId))
    .orderBy(schema.products.sort, schema.products.name)
    .all()

  const recipes = recipesByProduct(q, venueId, rows.map(r => r.product.id))
  const prices = openPrices(q, venueId)

  return rows.map(r => toProduct(r.product, r.categoryName, recipes.get(r.product.id) ?? [], prices.get(r.product.id) ?? null))
}

export function getProduct(q: Queryable, venueId: string, productId: string): ProductAdmin {
  const found = listProducts(q, venueId).find(p => p.id === productId)
  if (!found) throw notFound('PRODUCT_NOT_FOUND', 'no such product in this venue')
  return found
}

/**
 * `POST /api/admin/products`.
 *
 * The first `price_history` row is opened in the same transaction as the
 * product. The seed does the same for every product it writes, so the invariant
 * "every product has exactly one open price row, and it equals
 * `products.price_fen`" holds from the first minute rather than from the first
 * price change.
 */
export function createProduct(
  db: Db, venueId: string, actor: Actor, body: CreateProductBody, now = nowIso(),
): ProductAdmin {
  requireCategory(db, venueId, body.category_id)
  if (body.sells_stock_item_id) requireStockItem(db, venueId, body.sells_stock_item_id)

  const id = newId()

  db.transaction((tx) => {
    tx.insert(schema.products).values({
      id,
      venueId,
      categoryId: body.category_id,
      name: body.name,
      shortName: body.short_name ?? null,
      searchAliases: body.search_aliases ?? '',
      priceFen: body.price_fen,
      kind: body.kind ?? 'simple',
      sellsStockItemId: body.sells_stock_item_id ?? null,
      shishaGrams: body.shisha_grams ?? null,
      shishaGramsMeasuredAt: null,
      coalPcs: body.coal_pcs ?? null,
      staffDrinkAllowed: flag(body.staff_drink_allowed, 0),
      isFavourite: flag(body.is_favourite, 0),
      sort: body.sort ?? 0,
      active: flag(body.active, 1),
      createdAt: now,
      updatedAt: null,
    }).run()

    openPriceRow(tx, venueId, id, body.price_fen, actor.userId, now)

    log(tx, venueId, {
      kind: 'product_changed',
      body: { product_id: id, what: 'dodan' },
      actorId: actor.userId,
      ref: { type: 'product', id },
      at: now,
    })
    bump(tx, venueId, 'menu', id)
  })

  announce(db, venueId, 'menu', id)
  return getProduct(db, venueId, id)
}

/**
 * `PATCH /api/admin/products/:id` — including the price change (§6.10).
 *
 * A price edit is three writes and one of them is the point: the open
 * `price_history` row is closed at `now`, a new open row starts at `now`, and
 * `products.price_fen` follows. `order_lines` are never touched — they carry
 * `unit_price_fen` snapshotted at lock, which is what the guest was charged, and
 * rewriting them is how a corrected price would silently change last week's
 * pazar.
 */
export function updateProduct(
  db: Db, venueId: string, actor: Actor, productId: string, patch: UpdateProductBody,
  now = nowIso(),
): ProductAdmin {
  requireSomething(patch)
  const before = requireProduct(db, venueId, productId)

  if (patch.category_id) requireCategory(db, venueId, patch.category_id)
  if (patch.sells_stock_item_id) requireStockItem(db, venueId, patch.sells_stock_item_id)

  const priceMoved = patch.price_fen !== undefined && patch.price_fen !== before.priceFen
  const labels = changedLabels(before, patch, PRODUCT_LABELS, PRODUCT_COLUMNS)
    .filter(l => l !== PRODUCT_LABELS.price_fen)

  db.transaction((tx) => {
    tx.update(schema.products).set({
      ...(patch.category_id !== undefined ? { categoryId: patch.category_id } : {}),
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.short_name !== undefined ? { shortName: patch.short_name ?? null } : {}),
      ...(patch.search_aliases !== undefined ? { searchAliases: patch.search_aliases } : {}),
      ...(patch.price_fen !== undefined ? { priceFen: patch.price_fen } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.sells_stock_item_id !== undefined
        ? { sellsStockItemId: patch.sells_stock_item_id ?? null }
        : {}),
      ...(patch.shisha_grams !== undefined ? { shishaGrams: patch.shisha_grams ?? null } : {}),
      ...(patch.coal_pcs !== undefined ? { coalPcs: patch.coal_pcs ?? null } : {}),
      ...(patch.staff_drink_allowed !== undefined
        ? { staffDrinkAllowed: flag(patch.staff_drink_allowed, 0) }
        : {}),
      ...(patch.is_favourite !== undefined ? { isFavourite: flag(patch.is_favourite, 0) } : {}),
      ...(patch.sort !== undefined ? { sort: patch.sort } : {}),
      ...(patch.active !== undefined ? { active: flag(patch.active, 1) } : {}),
      updatedAt: now,
    }).where(eq(schema.products.id, productId)).run()

    if (priceMoved) {
      tx.update(schema.priceHistory)
        .set({ validTo: now })
        .where(and(
          eq(schema.priceHistory.venueId, venueId),
          eq(schema.priceHistory.productId, productId),
          isNull(schema.priceHistory.validTo),
        ))
        .run()
      openPriceRow(tx, venueId, productId, patch.price_fen!, actor.userId, now)

      log(tx, venueId, {
        kind: 'price_changed',
        body: { product_id: productId, before: before.priceFen, after: patch.price_fen! },
        actorId: actor.userId,
        ref: { type: 'product', id: productId },
        at: now,
      })
    }

    if (labels.length) {
      log(tx, venueId, {
        kind: 'product_changed',
        body: { product_id: productId, what: labels.join(', ') },
        actorId: actor.userId,
        ref: { type: 'product', id: productId },
        at: now,
      })
    }

    bump(tx, venueId, 'menu', productId)
  })

  announce(db, venueId, 'menu', productId)
  return getProduct(db, venueId, productId)
}

/**
 * `PUT /api/admin/products/:id/recipe` — the *normativ*, replaced whole.
 *
 * Delete-then-insert inside one transaction, so the product is never briefly
 * halfway through a recipe. `recipe_lines` has no append-only trigger for
 * exactly this reason: it is mutable configuration, and the ledger that records
 * what a recipe actually consumed is `stock_movements`, which is guarded.
 */
export function setRecipe(
  db: Db, venueId: string, actor: Actor, productId: string, body: SetRecipeBody, now = nowIso(),
): RecipeLine[] {
  requireProduct(db, venueId, productId)
  for (const line of body.lines) requireStockItem(db, venueId, line.stock_item_id)

  const seen = new Set<string>()
  for (const line of body.lines) {
    if (seen.has(line.stock_item_id)) {
      throw unprocessable('RECIPE_DUPLICATE', 'the same stock item appears twice in one recipe')
    }
    seen.add(line.stock_item_id)
  }

  db.transaction((tx) => {
    tx.delete(schema.recipeLines)
      .where(and(
        eq(schema.recipeLines.venueId, venueId),
        eq(schema.recipeLines.productId, productId),
      ))
      .run()

    for (const line of body.lines) {
      tx.insert(schema.recipeLines).values({
        id: newId(),
        venueId,
        productId,
        stockItemId: line.stock_item_id,
        qty: line.qty,
      }).run()
    }

    log(tx, venueId, {
      kind: 'recipe_changed',
      body: { product_id: productId, what: `${body.lines.length} stavki` },
      actorId: actor.userId,
      ref: { type: 'product', id: productId },
      at: now,
    })
    bump(tx, venueId, 'menu', productId)
  })

  announce(db, venueId, 'menu', productId)
  return recipeOf(db, venueId, productId)
}

// ===========================================================================
// Categories
// ===========================================================================

const CATEGORY_LABELS: Record<string, string> = {
  name: 'naziv',
  kind: 'vrsta',
  note_chips: 'napomene',
  sort: 'sortiranje',
  active: 'aktivna',
}

const CATEGORY_COLUMNS: Record<string, string> = {
  name: 'name',
  kind: 'kind',
  note_chips: 'noteChips',
  sort: 'sort',
  active: 'active',
}

export function listCategories(q: Queryable, venueId: string): CategoryAdmin[] {
  const rows = q.select().from(schema.categories)
    .where(eq(schema.categories.venueId, venueId))
    .orderBy(schema.categories.sort, schema.categories.name)
    .all()

  const counts = new Map(
    q.select({
      categoryId: schema.products.categoryId,
      n: sql<number>`count(*)`,
    })
      .from(schema.products)
      .where(and(eq(schema.products.venueId, venueId), eq(schema.products.active, 1)))
      .groupBy(schema.products.categoryId)
      .all()
      .map(r => [r.categoryId, r.n]),
  )

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    note_chips: parseChips(row.noteChipsJson),
    sort: row.sort,
    active: isOn(row.active),
    product_count: counts.get(row.id) ?? 0,
  }))
}

export function createCategory(
  db: Db, venueId: string, actor: Actor, body: CreateCategoryBody, now = nowIso(),
): CategoryAdmin {
  const id = newId()

  db.transaction((tx) => {
    tx.insert(schema.categories).values({
      id,
      venueId,
      name: body.name,
      kind: body.kind ?? 'ostalo',
      noteChipsJson: JSON.stringify(body.note_chips ?? []),
      sort: body.sort ?? 0,
      active: flag(body.active, 1),
    }).run()

    log(tx, venueId, {
      kind: 'category_changed',
      body: { category_id: id, what: 'dodana' },
      actorId: actor.userId,
      ref: { type: 'category', id },
      at: now,
    })
    bump(tx, venueId, 'menu', id)
  })

  announce(db, venueId, 'menu', id)
  return requireCategoryView(db, venueId, id)
}

export function updateCategory(
  db: Db, venueId: string, actor: Actor, categoryId: string, patch: UpdateCategoryBody,
  now = nowIso(),
): CategoryAdmin {
  requireSomething(patch)
  const row = requireCategory(db, venueId, categoryId)
  const before = { ...row, noteChips: parseChips(row.noteChipsJson) }
  const labels = changedLabels(before, patch, CATEGORY_LABELS, CATEGORY_COLUMNS)

  db.transaction((tx) => {
    tx.update(schema.categories).set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.note_chips !== undefined
        ? { noteChipsJson: JSON.stringify(patch.note_chips) }
        : {}),
      ...(patch.sort !== undefined ? { sort: patch.sort } : {}),
      ...(patch.active !== undefined ? { active: flag(patch.active, 1) } : {}),
    }).where(eq(schema.categories.id, categoryId)).run()

    if (labels.length) {
      log(tx, venueId, {
        kind: 'category_changed',
        body: { category_id: categoryId, what: labels.join(', ') },
        actorId: actor.userId,
        ref: { type: 'category', id: categoryId },
        at: now,
      })
    }
    bump(tx, venueId, 'menu', categoryId)
  })

  announce(db, venueId, 'menu', categoryId)
  return requireCategoryView(db, venueId, categoryId)
}

// ===========================================================================
// Tables — the floor plan
// ===========================================================================

const TABLE_LABELS: Record<string, string> = {
  name: 'naziv',
  zone: 'zona',
  col: 'kolona',
  row: 'red',
  grp: 'grupa',
  sort: 'sortiranje',
  active: 'aktivan',
}

const TABLE_COLUMNS: Record<string, string> = {
  name: 'name',
  zone: 'zone',
  col: 'col',
  row: 'row',
  grp: 'grp',
  sort: 'sort',
  active: 'active',
}

export function listTables(q: Queryable, venueId: string): TableAdmin[] {
  const rows = q.select().from(schema.tables)
    .where(eq(schema.tables.venueId, venueId))
    .orderBy(schema.tables.sort, schema.tables.name)
    .all()

  const busy = new Set(
    q.select({ tableId: schema.tabs.tableId }).from(schema.tabs)
      .where(and(eq(schema.tabs.venueId, venueId), eq(schema.tabs.status, 'open')))
      .all()
      .map(r => r.tableId),
  )

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    zone: row.zone,
    col: row.col,
    row: row.row,
    grp: row.grp,
    sort: row.sort,
    active: isOn(row.active),
    has_open_tab: busy.has(row.id),
  }))
}

export function createTable(
  db: Db, venueId: string, actor: Actor, body: CreateTableBody, now = nowIso(),
): TableAdmin {
  const id = newId()

  db.transaction((tx) => {
    tx.insert(schema.tables).values({
      id,
      venueId,
      name: body.name,
      zone: body.zone,
      col: body.col,
      row: body.row,
      grp: body.grp ?? null,
      sort: body.sort ?? 0,
      active: flag(body.active, 1),
    }).run()

    log(tx, venueId, {
      kind: 'table_changed',
      body: { table_id: id, what: 'dodan' },
      actorId: actor.userId,
      ref: { type: 'table', id },
      at: now,
    })
    // Two entities, because the floor plan is served by two payloads: the live
    // one (`tables_state`, attached to `table`) carries occupancy keyed by
    // `table_id`, and the names, zones and coordinates come from
    // `/api/bootstrap`, which a phone refetches when `menu_version` moves (§4.1).
    // A new table that bumped only `table` would appear as a row with no name.
    bump(tx, venueId, 'table', id)
    bump(tx, venueId, 'menu', id)
  })

  announce(db, venueId, 'table', id)
  return requireTableView(db, venueId, id)
}

/**
 * `PATCH /api/admin/tables/:id`.
 *
 * Deactivating a table with guests sitting at it is 409 `TABLE_HAS_OPEN_TAB`:
 * the tab would keep its `table_id` and vanish from a floor plan that only draws
 * active tables, which is the one way in this design for an open bill to become
 * invisible.
 */
export function updateTable(
  db: Db, venueId: string, actor: Actor, tableId: string, patch: UpdateTableBody,
  now = nowIso(),
): TableAdmin {
  requireSomething(patch)
  const before = requireTable(db, venueId, tableId)

  if (patch.active === false && hasOpenTab(db, venueId, tableId)) {
    throw conflict('TABLE_HAS_OPEN_TAB', 'this table has an open tab')
  }

  const labels = changedLabels(before, patch, TABLE_LABELS, TABLE_COLUMNS)

  db.transaction((tx) => {
    tx.update(schema.tables).set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.zone !== undefined ? { zone: patch.zone } : {}),
      ...(patch.col !== undefined ? { col: patch.col } : {}),
      ...(patch.row !== undefined ? { row: patch.row } : {}),
      ...(patch.grp !== undefined ? { grp: patch.grp ?? null } : {}),
      ...(patch.sort !== undefined ? { sort: patch.sort } : {}),
      ...(patch.active !== undefined ? { active: flag(patch.active, 1) } : {}),
    }).where(eq(schema.tables.id, tableId)).run()

    if (labels.length) {
      log(tx, venueId, {
        kind: 'table_changed',
        body: { table_id: tableId, what: labels.join(', ') },
        actorId: actor.userId,
        ref: { type: 'table', id: tableId },
        at: now,
      })
    }
    bump(tx, venueId, 'table', tableId)
    bump(tx, venueId, 'menu', tableId)
  })

  announce(db, venueId, 'table', tableId)
  return requireTableView(db, venueId, tableId)
}

// ===========================================================================
// Stock items
// ===========================================================================

const STOCK_LABELS: Record<string, string> = {
  name: 'naziv',
  kind: 'vrsta',
  base_unit: 'jedinica',
  category_id: 'kategorija',
  brand: 'marka',
  pack_name: 'pakovanje',
  pack_qty: 'količina u pakovanju',
  count_method: 'način popisa',
  tare_g: 'tara',
  tolerance_qty: 'tolerancija',
  par_qty: 'minimalna zaliha',
  last_cost_mfen: 'nabavna cijena',
  is_spot: 'brzi popis',
  available: 'dostupno',
  active: 'aktivna',
}

const STOCK_COLUMNS: Record<string, string> = {
  name: 'name',
  kind: 'kind',
  base_unit: 'baseUnit',
  category_id: 'categoryId',
  brand: 'brand',
  pack_name: 'packName',
  pack_qty: 'packQty',
  count_method: 'countMethod',
  tare_g: 'tareG',
  tolerance_qty: 'toleranceQty',
  par_qty: 'parQty',
  last_cost_mfen: 'lastCostMfen',
  is_spot: 'isSpot',
  available: 'available',
  active: 'active',
}

export function listStockItems(q: Queryable, venueId: string): StockItemAdmin[] {
  const rows = q.select({ item: schema.stockItems, categoryName: schema.categories.name })
    .from(schema.stockItems)
    .leftJoin(schema.categories, eq(schema.categories.id, schema.stockItems.categoryId))
    .where(eq(schema.stockItems.venueId, venueId))
    .orderBy(schema.stockItems.kind, schema.stockItems.name)
    .all()

  const moved = itemsWithMovements(q, venueId)

  return rows.map(({ item, categoryName }) => ({
    id: item.id,
    name: item.name,
    kind: item.kind,
    base_unit: item.baseUnit,
    category_id: item.categoryId,
    category_name: categoryName ?? null,
    brand: item.brand,
    pack_name: item.packName,
    pack_qty: item.packQty,
    avg_cost_mfen: item.avgCostMfen,
    last_cost_mfen: item.lastCostMfen,
    estimated_cost: unitCost(item).estimated,
    count_method: item.countMethod,
    tare_g: item.tareG,
    tolerance_qty: item.toleranceQty,
    par_qty: item.parQty,
    is_spot: isOn(item.isSpot),
    available: isOn(item.available),
    active: isOn(item.active),
    unit_frozen: moved.has(item.id),
  }))
}

/**
 * `POST /api/admin/stock-items`.
 *
 * The cost is **mandatory** and the refusal is a 422, not a 400: a missing cost
 * is a business rule with a Bosnian sentence behind it, not a malformed request.
 * §3.1 spells out what a zero cost switches off without saying so —
 * `variance_fen`, `waste_events.cost_fen`, *utrošak* and the `count_confirmed`
 * alert all quietly become zero, and a report of zeroes reads like good news.
 *
 * The first cost seeds **both** columns: an item whose only price is the one you
 * typed has that price as its moving average too, until the first delivery
 * recomputes it.
 */
export function createStockItem(
  db: Db, venueId: string, actor: Actor, body: CreateStockItemBody, now = nowIso(),
): StockItemAdmin {
  if (!body.last_cost_mfen) {
    throw unprocessable('COST_REQUIRED', 'a new stock item needs last_cost_mfen > 0')
  }
  if (body.category_id) requireCategory(db, venueId, body.category_id)

  const id = newId()

  db.transaction((tx) => {
    tx.insert(schema.stockItems).values({
      id,
      venueId,
      name: body.name,
      kind: body.kind,
      baseUnit: body.base_unit,
      categoryId: body.category_id ?? null,
      brand: body.brand ?? null,
      packName: body.pack_name ?? null,
      packQty: body.pack_qty ?? null,
      avgCostMfen: body.last_cost_mfen,
      lastCostMfen: body.last_cost_mfen,
      countMethod: body.count_method ?? 'count',
      tareG: body.tare_g ?? null,
      toleranceQty: body.tolerance_qty ?? 0,
      parQty: body.par_qty ?? null,
      isSpot: flag(body.is_spot, 0),
      available: flag(body.available, 1),
      active: flag(body.active, 1),
    }).run()

    log(tx, venueId, {
      kind: 'stock_item_changed',
      body: { stock_item_id: id, what: 'dodana' },
      actorId: actor.userId,
      ref: { type: 'stock_item', id },
      at: now,
    })
    bump(tx, venueId, 'stock', id)
    // The nargila flavour picker is drawn from `/api/bootstrap`, so a new aroma
    // has to move `menu_version` as well as the stock list (§4.1).
    bump(tx, venueId, 'menu', id)
  })

  announce(db, venueId, 'stock', id)
  return requireStockItemView(db, venueId, id)
}

/**
 * `PATCH /api/admin/stock-items/:id`.
 *
 * Two rules live here. **`base_unit` is frozen once the item has a movement**
 * (409 `UNIT_FROZEN`): on hand is `SUM(qty_delta)` over the whole ledger, and
 * changing the unit under it starts adding millilitres to grams with no error
 * anywhere. And **the first correct cost is retroactive**: a `last_cost_mfen`
 * set while `avg_cost_mfen` is still 0 seeds the average too, because a cost you
 * correct before your first delivery is the cost you had all along (§3.1).
 */
export function updateStockItem(
  db: Db, venueId: string, actor: Actor, itemId: string, patch: UpdateStockItemBody,
  now = nowIso(),
): StockItemAdmin {
  requireSomething(patch)
  const before = requireStockItem(db, venueId, itemId)

  if (patch.base_unit && patch.base_unit !== before.baseUnit
    && hasMovements(db, venueId, itemId)) {
    throw conflict('UNIT_FROZEN', 'this item already has stock movements')
  }
  if (patch.category_id) requireCategory(db, venueId, patch.category_id)

  const seedsAverage = patch.last_cost_mfen !== undefined
    && patch.last_cost_mfen > 0
    && before.avgCostMfen === 0

  const labels = changedLabels(before, patch, STOCK_LABELS, STOCK_COLUMNS)

  db.transaction((tx) => {
    tx.update(schema.stockItems).set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.base_unit !== undefined ? { baseUnit: patch.base_unit } : {}),
      ...(patch.category_id !== undefined ? { categoryId: patch.category_id ?? null } : {}),
      ...(patch.brand !== undefined ? { brand: patch.brand ?? null } : {}),
      ...(patch.pack_name !== undefined ? { packName: patch.pack_name ?? null } : {}),
      ...(patch.pack_qty !== undefined ? { packQty: patch.pack_qty ?? null } : {}),
      ...(patch.count_method !== undefined ? { countMethod: patch.count_method } : {}),
      ...(patch.tare_g !== undefined ? { tareG: patch.tare_g ?? null } : {}),
      ...(patch.tolerance_qty !== undefined ? { toleranceQty: patch.tolerance_qty } : {}),
      ...(patch.par_qty !== undefined ? { parQty: patch.par_qty ?? null } : {}),
      ...(patch.last_cost_mfen !== undefined ? { lastCostMfen: patch.last_cost_mfen } : {}),
      ...(seedsAverage ? { avgCostMfen: patch.last_cost_mfen } : {}),
      ...(patch.is_spot !== undefined ? { isSpot: flag(patch.is_spot, 0) } : {}),
      ...(patch.available !== undefined ? { available: flag(patch.available, 1) } : {}),
      ...(patch.active !== undefined ? { active: flag(patch.active, 1) } : {}),
    }).where(eq(schema.stockItems.id, itemId)).run()

    if (labels.length) {
      log(tx, venueId, {
        kind: 'stock_item_changed',
        body: { stock_item_id: itemId, what: labels.join(', ') },
        actorId: actor.userId,
        ref: { type: 'stock_item', id: itemId },
        at: now,
      })
    }
    bump(tx, venueId, 'stock', itemId)
    bump(tx, venueId, 'menu', itemId)
  })

  announce(db, venueId, 'stock', itemId)
  return requireStockItemView(db, venueId, itemId)
}

// ===========================================================================
// Users
// ===========================================================================

const USER_LABELS: Record<string, string> = {
  name: 'ime',
  initials: 'inicijali',
  role: 'uloga',
  active: 'aktivan',
  email: 'e-mail',
}

const USER_COLUMNS: Record<string, string> = {
  name: 'name',
  initials: 'initials',
  role: 'role',
  active: 'active',
  email: 'email',
}

/**
 * The one place a `users` row becomes a response.
 *
 * Written as an explicit field list rather than a spread, because the row it is
 * built from carries `pin_hash`, `password_hash` and `pin_pepper_v`, and a
 * `SELECT *` plus a spread is exactly how those reach a screen. `admin.test.ts`
 * greps every response for `/_hash$|token|password|pepper/`.
 */
function toUser(row: typeof schema.users.$inferSelect): UserAdmin {
  return {
    id: row.id,
    name: row.name,
    initials: row.initials,
    role: row.role,
    active: isOn(row.active),
    pin_len: row.pinLen === 6 ? 6 : 4,
    has_pin: row.pinHash !== null,
    email: row.email,
    created_at: row.createdAt,
  }
}

export function listUsers(q: Queryable, venueId: string): UserAdmin[] {
  return q.select().from(schema.users)
    .where(eq(schema.users.venueId, venueId))
    .orderBy(schema.users.name)
    .all()
    .map(toUser)
}

/**
 * `POST /api/admin/users` — a new person on the staff.
 *
 * The PIN is hashed with the same peppered scrypt every other secret in the app
 * uses (`server/utils/password.ts`), salted with the new user's own id. Only the
 * hash is stored and the response carries none of it: what comes back is the
 * same `UserAdmin` the list route returns.
 *
 * 4 or 6 digits are both legal for every role (§6.10) — the recommendation that
 * an admin uses 6 is advice on a screen, not a rule here, because a rule the
 * owner disagrees with at 23:00 is a rule he works around.
 */
export function createUser(
  db: Db, venueId: string, actor: Actor, body: CreateUserBody, now = nowIso(),
): UserAdmin {
  if (!/^\d{4}$|^\d{6}$/.test(body.pin)) {
    throw unprocessable('PIN_LENGTH', 'a pin is 4 or 6 digits')
  }
  if (body.email) requireEmailFree(db, body.email, null)

  const id = newId()

  db.transaction((tx) => {
    tx.insert(schema.users).values({
      id,
      venueId,
      name: body.name,
      initials: body.initials.toUpperCase(),
      role: body.role,
      active: 1,
      pinHash: hashSecret(body.pin, id),
      pinLen: body.pin.length === 6 ? 6 : 4,
      pinSetAt: now,
      pinPepperV: 1,
      passwordHash: null,
      email: body.email ?? null,
      logSeenAt: null,
      createdAt: now,
    }).run()

    log(tx, venueId, {
      kind: 'user_changed',
      body: { user_id: id, what: 'dodan' },
      actorId: actor.userId,
      ref: { type: 'user', id },
      at: now,
    })
    bump(tx, venueId, 'user', id)
  })

  announce(db, venueId, 'user', id)
  return requireUserView(db, venueId, id)
}

/**
 * `PATCH /api/admin/users/:id` — rename, re-role, deactivate, or set the
 * admin's e-mail.
 *
 * **An admin cannot deactivate himself** (400 `SELF_DEACTIVATE`). It is not
 * paternalism: the admin session is the only door into `/a` that does not need a
 * device, and the venue has one admin. Locking it from the inside would need a
 * shell on the VPS to undo.
 *
 * Deactivating is how somebody leaves. Nothing is deleted — his name still
 * renders on February's rounds, and `active = 0` is what `GET /api/auth/users`
 * filters the lock screen by.
 */
export function updateUser(
  db: Db, venueId: string, actor: Actor, userId: string, patch: UpdateUserBody, now = nowIso(),
): UserAdmin {
  requireSomething(patch)
  const before = requireUser(db, venueId, userId)

  if (patch.active === false && userId === actor.userId) {
    throw badRequest('SELF_DEACTIVATE', 'an admin may not deactivate himself')
  }
  if (patch.email) requireEmailFree(db, patch.email, userId)

  const labels = changedLabels(before, patch, USER_LABELS, USER_COLUMNS)
  const deactivated = patch.active === false && isOn(before.active)

  db.transaction((tx) => {
    tx.update(schema.users).set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.initials !== undefined ? { initials: patch.initials.toUpperCase() } : {}),
      ...(patch.role !== undefined ? { role: patch.role } : {}),
      ...(patch.active !== undefined ? { active: flag(patch.active, 1) } : {}),
      ...(patch.email !== undefined ? { email: patch.email ?? null } : {}),
    }).where(eq(schema.users.id, userId)).run()

    if (labels.length) {
      log(tx, venueId, {
        kind: 'user_changed',
        // The body carries the *what*, never the value: an entry that stored
        // an e-mail address would put it in the Dnevnik for everyone to read.
        body: { user_id: userId, what: deactivated ? 'deaktiviran' : 'promijenjen' },
        actorId: actor.userId,
        ref: { type: 'user', id: userId },
        at: now,
      })
    }
    bump(tx, venueId, 'user', userId)
  })

  announce(db, venueId, 'user', userId)
  return requireUserView(db, venueId, userId)
}

/**
 * `POST /api/admin/users/:id/pin` — the route is WP6's, the logic is WP1's.
 *
 * §12 puts `api/admin/users/**` here because it is admin CRUD like every other
 * file in the folder, and `resetPin` in `services/auth.ts` because it is auth:
 * it hashes with the pepper, clears `devices.locked_at` on the phones this
 * person locked out, and writes both the `user_changed` and the
 * `device_unlocked` entries. Wrapping it here rather than reimplementing it is
 * the whole point — two PIN-writing code paths is one too many.
 */
export type { PinResetResult }

// ===========================================================================
// Settings
// ===========================================================================

/** `GET /api/admin/settings` — the defaults with the owner's overrides on top. */
export function getVenueSettings(q: Queryable, venueId: string): Settings {
  return getSettings(q, venueId)
}

/**
 * `PATCH /api/admin/settings` — one Dnevnik entry per changed key.
 *
 * Per key, not per save, because "Postavke promijenjene" with no key in it is an
 * entry nobody can act on three weeks later. A key sent with the value it
 * already had writes nothing: re-saving a form is not an event.
 *
 * `settings_json` keeps only what the owner has actually touched (§3.5), so a
 * default that changes in a later release moves for everybody who never
 * overrode it.
 */
export function updateSettings(
  db: Db, venueId: string, actor: Actor, patch: SettingsPatch, now = nowIso(),
): Settings {
  requireSomething(patch)

  const row = db.select({ json: schema.venues.settingsJson }).from(schema.venues)
    .where(eq(schema.venues.id, venueId))
    .get()
  const before = mergeSettings(row?.json)
  const stored = safeParse(row?.json)

  const changed = (Object.keys(patch) as (keyof Settings)[])
    .filter(key => !same(
      before[key] as unknown,
      (patch as Record<string, unknown>)[key as string],
    ))

  db.transaction((tx) => {
    tx.update(schema.venues)
      .set({ settingsJson: JSON.stringify({ ...stored, ...patch }) })
      .where(eq(schema.venues.id, venueId))
      .run()

    for (const key of changed) {
      log(tx, venueId, {
        kind: 'settings_changed',
        body: {
          key: String(key),
          label: SETTINGS_LABELS[key] ?? String(key),
          before: before[key],
          after: (patch as Record<string, unknown>)[key as string],
        },
        actorId: actor.userId,
        ref: { type: 'venue', id: venueId },
        at: now,
      })
    }

    bump(tx, venueId, 'settings', venueId)
  })

  announce(db, venueId, 'settings', venueId)
  return getSettings(db, venueId)
}

// ===========================================================================
// Lookups — one "no such thing here" per entity, all venue-scoped
// ===========================================================================

function requireProduct(q: Queryable, venueId: string, id: string) {
  const row = q.select().from(schema.products)
    .where(and(eq(schema.products.id, id), eq(schema.products.venueId, venueId)))
    .get()
  if (!row) throw notFound('PRODUCT_NOT_FOUND', 'no such product in this venue')
  return row
}

function requireCategory(q: Queryable, venueId: string, id: string) {
  const row = q.select().from(schema.categories)
    .where(and(eq(schema.categories.id, id), eq(schema.categories.venueId, venueId)))
    .get()
  if (!row) throw notFound('CATEGORY_NOT_FOUND', 'no such category in this venue')
  return row
}

function requireTable(q: Queryable, venueId: string, id: string) {
  const row = q.select().from(schema.tables)
    .where(and(eq(schema.tables.id, id), eq(schema.tables.venueId, venueId)))
    .get()
  if (!row) throw notFound('TABLE_NOT_FOUND', 'no such table in this venue')
  return row
}

function requireStockItem(q: Queryable, venueId: string, id: string) {
  const row = q.select().from(schema.stockItems)
    .where(and(eq(schema.stockItems.id, id), eq(schema.stockItems.venueId, venueId)))
    .get()
  if (!row) throw notFound('STOCK_ITEM_NOT_FOUND', 'no such stock item in this venue')
  return row
}

function requireUser(q: Queryable, venueId: string, id: string) {
  const row = q.select().from(schema.users)
    .where(and(eq(schema.users.id, id), eq(schema.users.venueId, venueId)))
    .get()
  if (!row) throw notFound('USER_NOT_FOUND', 'no such user in this venue')
  return row
}

/**
 * `users_email_uq` is global rather than per-venue (an email identifies a person
 * before a venue is known), so the check is too — and it is a check rather than
 * a caught constraint error, because a raw SQLITE_CONSTRAINT reaches the screen
 * as a 500.
 */
function requireEmailFree(q: Queryable, email: string, exceptUserId: string | null): void {
  const clash = q.select({ id: schema.users.id }).from(schema.users)
    .where(exceptUserId
      ? and(eq(schema.users.email, email), ne(schema.users.id, exceptUserId))
      : eq(schema.users.email, email))
    .get()
  if (clash) throw conflict('EMAIL_TAKEN', 'that email already belongs to somebody')
}

function requireCategoryView(q: Queryable, venueId: string, id: string): CategoryAdmin {
  const found = listCategories(q, venueId).find(c => c.id === id)
  if (!found) throw notFound('CATEGORY_NOT_FOUND', 'no such category in this venue')
  return found
}

function requireTableView(q: Queryable, venueId: string, id: string): TableAdmin {
  const found = listTables(q, venueId).find(t => t.id === id)
  if (!found) throw notFound('TABLE_NOT_FOUND', 'no such table in this venue')
  return found
}

function requireStockItemView(q: Queryable, venueId: string, id: string): StockItemAdmin {
  const found = listStockItems(q, venueId).find(i => i.id === id)
  if (!found) throw notFound('STOCK_ITEM_NOT_FOUND', 'no such stock item in this venue')
  return found
}

function requireUserView(q: Queryable, venueId: string, id: string): UserAdmin {
  return toUser(requireUser(q, venueId, id))
}

// ===========================================================================
// Row helpers
// ===========================================================================

/** The one open `price_history` row, per product. `price_history_open_uq` enforces it. */
function openPriceRow(
  tx: Tx, venueId: string, productId: string, priceFen: number, changedBy: string, at: string,
): void {
  tx.insert(schema.priceHistory).values({
    id: newId(),
    venueId,
    productId,
    priceFen,
    validFrom: at,
    validTo: null,
    changedBy,
  }).run()
}

function openPrices(q: Queryable, venueId: string): Map<string, string> {
  return new Map(
    q.select({ productId: schema.priceHistory.productId, from: schema.priceHistory.validFrom })
      .from(schema.priceHistory)
      .where(and(
        eq(schema.priceHistory.venueId, venueId),
        isNull(schema.priceHistory.validTo),
      ))
      .all()
      .map(r => [r.productId, r.from]),
  )
}

function recipeOf(q: Queryable, venueId: string, productId: string): RecipeLine[] {
  return recipesByProduct(q, venueId, [productId]).get(productId) ?? []
}

function recipesByProduct(
  q: Queryable, venueId: string, productIds: string[],
): Map<string, RecipeLine[]> {
  const out = new Map<string, RecipeLine[]>()
  if (!productIds.length) return out

  const rows = q.select({
    productId: schema.recipeLines.productId,
    stockItemId: schema.recipeLines.stockItemId,
    qty: schema.recipeLines.qty,
    name: schema.stockItems.name,
    baseUnit: schema.stockItems.baseUnit,
  })
    .from(schema.recipeLines)
    .innerJoin(schema.stockItems, eq(schema.stockItems.id, schema.recipeLines.stockItemId))
    .where(and(
      eq(schema.recipeLines.venueId, venueId),
      inArray(schema.recipeLines.productId, productIds),
    ))
    .all()

  for (const row of rows) {
    const list = out.get(row.productId) ?? []
    list.push({
      stock_item_id: row.stockItemId,
      stock_item_name: row.name,
      base_unit: row.baseUnit,
      qty: row.qty,
    })
    out.set(row.productId, list)
  }
  return out
}

function toProduct(
  row: typeof schema.products.$inferSelect,
  categoryName: string,
  recipe: RecipeLine[],
  priceSince: string | null,
): ProductAdmin {
  return {
    id: row.id,
    category_id: row.categoryId,
    category_name: categoryName,
    name: row.name,
    short_name: row.shortName,
    search_aliases: row.searchAliases,
    price_fen: row.priceFen,
    price_since: priceSince,
    kind: row.kind,
    sells_stock_item_id: row.sellsStockItemId,
    shisha_grams: row.shishaGrams,
    shisha_grams_measured_at: row.shishaGramsMeasuredAt,
    coal_pcs: row.coalPcs,
    staff_drink_allowed: isOn(row.staffDrinkAllowed),
    is_favourite: isOn(row.isFavourite),
    sort: row.sort,
    active: isOn(row.active),
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    recipe,
  }
}

function hasOpenTab(q: Queryable, venueId: string, tableId: string): boolean {
  return q.select({ id: schema.tabs.id }).from(schema.tabs)
    .where(and(
      eq(schema.tabs.venueId, venueId),
      eq(schema.tabs.tableId, tableId),
      eq(schema.tabs.status, 'open'),
    ))
    .get() !== undefined
}

function hasMovements(q: Queryable, venueId: string, itemId: string): boolean {
  return q.select({ id: schema.stockMovements.id }).from(schema.stockMovements)
    .where(and(
      eq(schema.stockMovements.venueId, venueId),
      eq(schema.stockMovements.stockItemId, itemId),
    ))
    .get() !== undefined
}

function itemsWithMovements(q: Queryable, venueId: string): Set<string> {
  return new Set(
    q.selectDistinct({ id: schema.stockMovements.stockItemId })
      .from(schema.stockMovements)
      .where(eq(schema.stockMovements.venueId, venueId))
      .all()
      .map(r => r.id),
  )
}

function parseChips(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string') : []
  } catch {
    return []
  }
}

function safeParse(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {}
  try {
    const parsed: unknown = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}
