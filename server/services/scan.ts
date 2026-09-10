/**
 * *Prijem sa slike* — a photo of an otpremnica becomes a **draft** (PHASE4 §2.9).
 *
 * `scanDelivery` is the only `async` service in this codebase, and it is async
 * **around** its transactions and never inside one: read the upload and the
 * catalogue → `await model.read(...)` → open a transaction and write the row.
 * better-sqlite3 is synchronous, and a `db.transaction()` body containing an
 * `await` would commit somewhere in the middle of the wait (BACKEND §2).
 *
 * **The server never trusts the model's ids.** Every `stock_item_id` it returns
 * is looked up in the real catalogue and dropped when it does not exist — a
 * hallucinated uuid becomes an *unknown* line, not a green one pointing at
 * nothing. An exact `supplier_aliases` hit on the folded OCR text **overrides**
 * the model at confidence 1.0, which is what makes the second photo from the
 * same supplier free.
 *
 * **Nothing here posts stock.** Prices from the model are a suggestion the owner
 * edits, exactly like the typed form's `line_cost_fen`, and they reach a
 * movement only through *Proknjiži* → `POST /api/stock/deliveries`.
 */
import { readFileSync } from 'node:fs'
import { and, eq } from 'drizzle-orm'
import { schema } from '../database/client'
import { newId, nowIso } from '../utils/ids'
import { conflict, notFound, SankError } from '../utils/errors'
import { errorMessage } from '#shared/errors'
import type {
  DiscardScanBody, LinkAliasBody, ScanAliasLine, ScanCatalogueLine,
  ScanDraft, ScanDraftLine, ScanMatch, ScanParse,
} from '#shared/types'
import type { Actor, Db, Queryable, Tx } from './types'
import { bump } from './changes'
import { log } from './log'
import { absolutePath, requireDeliveryUpload } from './uploads'

export interface ScanModel {
  read(input: {
    imageBase64: string
    catalogue: ScanCatalogueLine[]
    aliases: ScanAliasLine[]
  }): Promise<ScanParse>
}

/** Green at 0.8 and above, amber down to 0.4, unknown below that. */
const GREEN = 0.8
const AMBER = 0.4

let injected: ScanModel | null = null

/**
 * Tests inject a stub; `null` restores the real one (or none, with no key).
 *
 * This is the seam that lets the whole feature be tested without an API key and
 * without a network: `SANK_SCAN_STUB=1` installs the deterministic model below
 * at boot for the verification run, and vitest calls this directly.
 */
export function setScanModel(model: ScanModel | null): void {
  injected = model
}

/** The model in force right now, or `null` when nothing is configured. */
export async function currentScanModel(): Promise<ScanModel | null> {
  if (injected) return injected
  const { realScanModel } = await import('./scanModel')
  return realScanModel()
}

/**
 * `POST /api/stock/deliveries/scan` — the photo, the model, and the draft.
 */
export async function scanDelivery(
  db: Db, venueId: string, actor: Actor, body: { upload_id: string }, now = nowIso(),
): Promise<ScanDraft> {
  const upload = requireDeliveryUpload(db, venueId, actor, body.upload_id)

  const model = await currentScanModel()
  if (!model) {
    throw new SankError(503, 'SCAN_NOT_CONFIGURED', errorMessage('SCAN_NOT_CONFIGURED'))
  }

  const catalogue = catalogueOf(db, venueId)
  const aliases = aliasesOf(db, venueId)

  // Everything above this line is synchronous reads; everything below it is one
  // `await` and then one transaction. No transaction is open across the wait.
  let parse: ScanParse | null = null
  let error: string | null = null
  try {
    parse = await model.read({
      imageBase64: readFileSync(absolutePath(upload.path)).toString('base64'),
      catalogue,
      aliases,
    })
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  const modelId = (await import('./scanModel')).SCAN_MODEL_ID
  const lines = parse ? matchLines(parse, catalogue, aliases) : []

  const scanId = newId()
  db.transaction((tx) => {
    tx.insert(schema.deliveryScans).values({
      id: scanId,
      venueId,
      uploadId: upload.id,
      model: modelId,
      rawJson: parse ? JSON.stringify(parse) : null,
      status: 'uploaded',
      error: null,
      createdBy: actor.userId,
      createdAt: now,
    }).run()

    // `uploaded -> parsed` is the one move that may write `raw_json`, `error`
    // and `parsed_at` — see `delivery_scans_status_guard`.
    tx.update(schema.deliveryScans)
      .set({ status: 'parsed', error, parsedAt: now })
      .where(eq(schema.deliveryScans.id, scanId))
      .run()

    log(tx, venueId, {
      kind: 'delivery_scanned',
      body: {
        scan_id: scanId,
        upload_id: upload.id,
        lines: lines.length,
        green: lines.filter(l => l.match === 'green').length,
        error: error !== null,
      },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      ref: { type: 'delivery_scan', id: scanId },
      at: now,
    })

    bump(tx, venueId, 'stock', scanId)
  })

  return {
    scan_id: scanId,
    upload_id: upload.id,
    image_url: `/api/uploads/${upload.id}`,
    model: modelId,
    status: 'parsed',
    supplier: parse?.supplier ?? null,
    invoice_no: parse?.invoice_no ?? null,
    date: parse?.date ?? null,
    lines,
    counts: {
      green: lines.filter(l => l.match === 'green').length,
      amber: lines.filter(l => l.match === 'amber').length,
      unknown: lines.filter(l => l.match === 'unknown').length,
    },
    error,
  }
}

/**
 * *Poveži* — what makes the second photo from this supplier come back green.
 *
 * The alias is folded (lowercased, diacritics stripped, punctuation and runs of
 * whitespace collapsed) before it is stored, so "Coca Cola 0,25" and
 * "coca-cola 0.25" collide on purpose.
 */
export function linkAlias(
  db: Db, venueId: string, actor: Actor, body: LinkAliasBody, now = nowIso(),
): void {
  db.transaction((tx) => {
    const item = tx.select().from(schema.stockItems)
      .where(and(eq(schema.stockItems.venueId, venueId), eq(schema.stockItems.id, body.stock_item_id)))
      .get()
    if (!item) throw notFound('STOCK_ITEM_NOT_FOUND', `stock item ${body.stock_item_id} not found`)

    const folded = fold(body.alias)
    const existing = tx.select().from(schema.supplierAliases)
      .where(and(eq(schema.supplierAliases.venueId, venueId), eq(schema.supplierAliases.alias, folded)))
      .get()
    if (existing) throw conflict('ALIAS_EXISTS', `alias "${folded}" already points somewhere`)

    tx.insert(schema.supplierAliases).values({
      id: newId(),
      venueId,
      stockItemId: item.id,
      alias: folded,
      supplierName: body.supplier_name ?? null,
      createdBy: actor.userId,
      createdAt: now,
    }).run()

    log(tx, venueId, {
      kind: 'alias_linked',
      body: { alias: folded, stock_item_id: item.id, supplier: body.supplier_name ?? null },
      actorId: actor.userId,
      ref: { type: 'stock_item', id: item.id },
      at: now,
    })

    bump(tx, venueId, 'stock', item.id)
  })
}

/** *Odbaci sken* — with a reason, and the hourly GC then unlinks its photo. */
export function discardScan(
  db: Db, venueId: string, actor: Actor, id: string, body: DiscardScanBody, now = nowIso(),
): void {
  db.transaction((tx) => {
    const row = requireScan(tx, venueId, id)
    if (row.status === 'applied') throw conflict('SCAN_ALREADY_APPLIED', 'that scan is already posted')
    if (row.status === 'discarded') throw conflict('ALREADY_DECIDED', 'that scan is already discarded')

    tx.update(schema.deliveryScans)
      .set({ status: 'discarded' })
      .where(eq(schema.deliveryScans.id, row.id))
      .run()

    log(tx, venueId, {
      kind: 'delivery_discarded',
      body: { scan_id: row.id, reason: body.reason },
      actorId: actor.userId,
      ref: { type: 'delivery_scan', id: row.id },
      at: now,
    })

    bump(tx, venueId, 'stock', row.id)
  })
}

/**
 * Called by `createDelivery` inside the delivery's own transaction: the scan
 * flips to `applied` in the same commit that writes the movements, so there is
 * no window in which a posted delivery points at a scan that is still `parsed`.
 */
export function applyScan(tx: Tx, venueId: string, scanId: string): void {
  const row = tx.select().from(schema.deliveryScans)
    .where(and(eq(schema.deliveryScans.venueId, venueId), eq(schema.deliveryScans.id, scanId)))
    .get()
  if (!row) throw notFound('SCAN_NOT_FOUND', `scan ${scanId} not found`)
  if (row.status === 'applied') throw conflict('SCAN_ALREADY_APPLIED', 'that scan is already posted')
  if (row.status !== 'parsed') throw conflict('SCAN_NOT_PARSED', `scan ${scanId} is ${row.status}`)

  tx.update(schema.deliveryScans)
    .set({ status: 'applied' })
    .where(eq(schema.deliveryScans.id, row.id))
    .run()
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * The model's answer, checked against reality.
 *
 * Order matters: the alias wins, then the model's id if it exists, then nothing.
 * A learned alias is the owner's own decision from last month and outranks a
 * fresh guess by definition.
 */
export function matchLines(
  parse: ScanParse, catalogue: ScanCatalogueLine[], aliases: ScanAliasLine[],
): ScanDraftLine[] {
  const byId = new Map(catalogue.map(c => [c.id, c] as const))
  const byAlias = new Map(aliases.map(a => [a.alias, a] as const))

  return parse.lines.map((line) => {
    const alias = byAlias.get(fold(line.text))
    let itemId: string | null = null
    let confidence = line.confidence
    let fromAlias = false

    if (alias && byId.has(alias.stock_item_id)) {
      itemId = alias.stock_item_id
      confidence = 1
      fromAlias = true
    } else if (line.stock_item_id && byId.has(line.stock_item_id)) {
      // The one place the model's id is allowed through, and only after the
      // lookup. A uuid it invented simply is not here.
      itemId = line.stock_item_id
    }

    const match: ScanMatch = itemId === null
      ? 'unknown'
      : confidence >= GREEN ? 'green' : confidence >= AMBER ? 'amber' : 'unknown'

    return {
      text: line.text,
      qty: line.qty,
      pack: line.pack,
      unit_price_fen: line.unit_price_fen,
      stock_item_id: match === 'unknown' ? null : itemId,
      stock_item_name: match === 'unknown' ? null : byId.get(itemId!)?.name ?? null,
      confidence,
      match,
      from_alias: fromAlias,
    }
  })
}

/**
 * Fold a supplier's spelling to one comparable key.
 *
 * `NFD` splits "č" into "c" + a combining caron, and the regex then drops every
 * combining mark — which is how "Čaj" and "caj" become the same string without
 * a table of Bosnian letters.
 */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function catalogueOf(q: Queryable, venueId: string): ScanCatalogueLine[] {
  return q.select({
    id: schema.stockItems.id,
    name: schema.stockItems.name,
    brand: schema.stockItems.brand,
    packName: schema.stockItems.packName,
    packQty: schema.stockItems.packQty,
    baseUnit: schema.stockItems.baseUnit,
  }).from(schema.stockItems)
    .where(and(eq(schema.stockItems.venueId, venueId), eq(schema.stockItems.active, 1)))
    .all()
    .map(i => ({
      id: i.id,
      name: i.name,
      brand: i.brand,
      pack_name: i.packName,
      pack_qty: i.packQty,
      base_unit: i.baseUnit,
    }))
}

export function aliasesOf(q: Queryable, venueId: string): ScanAliasLine[] {
  return q.select().from(schema.supplierAliases)
    .where(eq(schema.supplierAliases.venueId, venueId))
    .all()
    .map(a => ({
      alias: a.alias,
      stock_item_id: a.stockItemId,
      supplier_name: a.supplierName,
    }))
}

function requireScan(q: Queryable, venueId: string, id: string) {
  const row = q.select().from(schema.deliveryScans)
    .where(and(eq(schema.deliveryScans.venueId, venueId), eq(schema.deliveryScans.id, id)))
    .get()
  if (!row) throw notFound('SCAN_NOT_FOUND', `scan ${id} not found`)
  return row
}

// ---------------------------------------------------------------------------
// The stub
// ---------------------------------------------------------------------------

/**
 * The deterministic model behind `SANK_SCAN_STUB=1` and every unit test.
 *
 * It returns a fixed eight-line otpremnica against whatever catalogue it is
 * handed: six green, one amber and one unknown. It is read **once at boot**, is
 * never true in production, and is the only reason the scan check of the
 * verification run costs nothing and never calls the API.
 */
export function stubScanModel(): ScanModel {
  return {
    read({ catalogue }) {
      const pick = (n: number) => catalogue[n % Math.max(catalogue.length, 1)]
      const green = [0, 1, 2, 3, 4, 5].map((n) => {
        const item = pick(n)!
        return {
          text: `${item.name} ${item.pack_name ?? 'kom'}`,
          qty: 2,
          pack: item.pack_name ?? null,
          unit_price_fen: 2400 + n * 100,
          stock_item_id: item.id,
          confidence: 0.95,
        }
      })

      const amberItem = pick(6)!
      return Promise.resolve({
        supplier: 'Dobavljač d.o.o.',
        invoice_no: 'OTP-2026-0912',
        date: '2026-09-12',
        lines: [
          ...green,
          {
            text: `${amberItem.name} (nečitko)`,
            qty: 1,
            pack: null,
            unit_price_fen: 1800,
            stock_item_id: amberItem.id,
            confidence: 0.55,
          },
          {
            text: 'Salvete 33x33 bijele',
            qty: 4,
            pack: 'paket',
            unit_price_fen: 900,
            stock_item_id: null,
            confidence: 0.2,
          },
        ],
      })
    },
  }
}
