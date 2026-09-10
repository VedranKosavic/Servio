/**
 * *Prijem sa slike* (PHASE4 §2.9), with the stub model injected.
 *
 * The block that matters most is "the server never trusts the model's ids": a
 * hallucinated `stock_item_id` has to come back as an **unknown** line, not as a
 * green one pointing at nothing. Everything else in this feature is the owner
 * reading a draft and correcting it, which is the design.
 *
 * No test here calls the API, and none can: `setScanModel` is the seam, and the
 * last case proves the un-configured path is a supported state rather than a
 * broken one.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { expectCode, jpegBytes, scratchUploads, type Scratch } from '../helpers/phase4'
import type { ScanModel } from '../../server/services/scan'
import {
  catalogueOf, discardScan, fold, linkAlias, matchLines,
  scanDelivery, setScanModel, stubScanModel,
} from '../../server/services/scan'
import { createUpload } from '../../server/services/uploads'
import { createDelivery } from '../../server/services/stock'

let f: Fixture
let scratch: Scratch

beforeEach(() => {
  f = makeFixture()
  scratch = scratchUploads()
  setScanModel(stubScanModel())
})
afterEach(() => {
  setScanModel(null)
  f.close()
  scratch.cleanup()
})

const photo = (who = 'Haris') =>
  createUpload(
    f.db, f.venueId, f.actor(who), { bytes: jpegBytes(1600, 1200) }, 'delivery', f.clock.now(),
  ).id

const scan = (uploadId = photo()) =>
  scanDelivery(f.db, f.venueId, f.adminActor(), { upload_id: uploadId }, f.clock.now())

/** A model that answers exactly `lines`, whatever the catalogue says. */
function fixedModel(lines: Array<Record<string, unknown>>): ScanModel {
  return {
    read: () => Promise.resolve({
      supplier: 'Dobavljač d.o.o.', invoice_no: 'OTP-1', date: '2026-09-12',
      lines: lines as never,
    }),
  }
}

describe('scanDelivery with the stub', () => {
  it('returns six green lines, one amber and one unknown', async () => {
    const draft = await scan()

    expect(draft.status).toBe('parsed')
    expect(draft.counts).toEqual({ green: 6, amber: 1, unknown: 1 })
    expect(draft.supplier).toBe('Dobavljač d.o.o.')

    // Green lines carry a real id from the venue's own catalogue.
    const catalogue = new Set(catalogueOf(f.db, f.venueId).map(c => c.id))
    for (const line of draft.lines.filter(l => l.match === 'green')) {
      expect(catalogue.has(line.stock_item_id!)).toBe(true)
      expect(line.stock_item_name).toBeTruthy()
    }

    // The amber line keeps its OCR text beside the guess.
    const amber = draft.lines.find(l => l.match === 'amber')!
    expect(amber.text).toContain('nečitko')
    expect(amber.stock_item_id).not.toBeNull()

    // The unknown one has nothing to point at, and says so.
    const unknown = draft.lines.find(l => l.match === 'unknown')!
    expect(unknown.text).toBe('Salvete 33x33 bijele')
    expect(unknown.stock_item_id).toBeNull()
  })

  it('writes one parsed row, keeps the raw answer, and logs it quietly', async () => {
    const draft = await scan()
    const row = f.db.select().from(schema.deliveryScans)
      .where(eq(schema.deliveryScans.id, draft.scan_id)).get()!

    expect([row.status, row.error]).toEqual(['parsed', null])
    expect(row.parsedAt).not.toBeNull()
    expect(JSON.parse(row.rawJson!).lines).toHaveLength(8)

    expect(f.db.select().from(schema.logEntries).all()
      .some(e => e.kind === 'delivery_scanned')).toBe(true)
  })

  it('writes nothing to stock_movements — a draft is not a delivery', async () => {
    const before = f.db.select().from(schema.stockMovements).all().length
    await scan()
    expect(f.db.select().from(schema.stockMovements).all().length).toBe(before)
  })

  it('refuses a photo that is not a delivery photo, and somebody else\'s', async () => {
    const chat = createUpload(
      f.db, f.venueId, f.actor('Amar'), { bytes: jpegBytes() }, 'chat', f.clock.now(),
    )
    await expect(scanDelivery(
      f.db, f.venueId, f.adminActor(), { upload_id: chat.id }, f.clock.now(),
    )).rejects.toThrow(/not a delivery photo/)

    const emirs = photo('Emir')
    await expect(scanDelivery(
      f.db, f.venueId, f.actor('Emir'), { upload_id: emirs }, f.clock.now(),
    )).resolves.toBeTruthy()
  })
})

describe('the server never trusts the model\'s ids', () => {
  it('turns a hallucinated stock_item_id into an unknown line, not a green one', async () => {
    setScanModel(fixedModel([{
      text: 'Coca-Cola 0,25 l gajba',
      qty: 24, pack: 'gajba', unit_price_fen: 2400,
      stock_item_id: randomUUID(), // a uuid the catalogue has never seen
      confidence: 0.99,
    }]))

    const draft = await scan()
    expect(draft.lines[0]!.match).toBe('unknown')
    expect(draft.lines[0]!.stock_item_id).toBeNull()
    // The OCR text survives, so the owner can *Poveži* it.
    expect(draft.lines[0]!.text).toContain('Coca-Cola')
  })

  it('lets an exact alias override a low model confidence, at 1.0', async () => {
    const item = f.stockItemId('Coca-Cola 0,25 l')
    linkAlias(f.db, f.venueId, f.adminActor(), {
      alias: 'Coca Cola 0,25', stock_item_id: item, supplier_name: 'Coca-Cola HBC',
    }, f.clock.now())

    setScanModel(fixedModel([{
      text: 'coca-cola 0.25',
      qty: 24, pack: 'gajba', unit_price_fen: 2400,
      stock_item_id: null,
      confidence: 0.1,
    }]))

    const draft = await scan()
    expect(draft.lines[0]!.match).toBe('green')
    expect(draft.lines[0]!.stock_item_id).toBe(item)
    expect(draft.lines[0]!.confidence).toBe(1)
    expect(draft.lines[0]!.from_alias).toBe(true)
  })

  it('folds diacritics, case and punctuation so a supplier\'s spelling collides on purpose', () => {
    expect(fold('Coca Cola 0,25')).toBe('coca cola 0 25')
    expect(fold('coca-cola  0.25')).toBe('coca cola 0 25')
    expect(fold('Čaj — Šumsko voće')).toBe('caj sumsko voce')
  })

  it('bands confidence at 0.8 and 0.4', () => {
    const catalogue = catalogueOf(f.db, f.venueId)
    const first = catalogue[0]!
    const line = (confidence: number) => ({
      text: first.name, qty: 1, pack: null, unit_price_fen: 100,
      stock_item_id: first.id, confidence,
    })

    const matched = matchLines(
      { supplier: null, invoice_no: null, date: null, lines: [line(0.8), line(0.79), line(0.39)] },
      catalogue, [],
    )
    expect(matched.map(l => l.match)).toEqual(['green', 'amber', 'unknown'])
  })
})

describe('linkAlias', () => {
  it('stores the folded form and refuses a second one pointing elsewhere', () => {
    linkAlias(f.db, f.venueId, f.adminActor(), {
      alias: 'Coca Cola 0,25', stock_item_id: f.stockItemId('Coca-Cola 0,25 l'),
    }, f.clock.now())

    const row = f.db.select().from(schema.supplierAliases).all()[0]!
    expect(row.alias).toBe('coca cola 0 25')

    expectCode(() => linkAlias(f.db, f.venueId, f.adminActor(), {
      alias: 'coca-cola 0.25', stock_item_id: f.stockItemId('Fanta 0,25 l'),
    }, f.clock.now()), 'ALIAS_EXISTS')
  })

  it('refuses an item that does not exist', () => {
    expectCode(() => linkAlias(f.db, f.venueId, f.adminActor(), {
      alias: 'nešto', stock_item_id: randomUUID(),
    }, f.clock.now()), 'STOCK_ITEM_NOT_FOUND')
  })
})

describe('Proknjiži and Odbaci', () => {
  it('flips the scan to applied inside the delivery\'s own transaction', async () => {
    const draft = await scan()
    const line = draft.lines.find(l => l.match === 'green')!

    const delivery = createDelivery(f.db, f.venueId, f.adminActor(), {
      client_id: randomUUID(),
      supplier_name: draft.supplier ?? 'Dobavljač',
      source: 'scan',
      scan_id: draft.scan_id,
      lines: [{ stock_item_id: line.stock_item_id!, packs: 0, loose: 6, line_cost_fen: 2400 }],
    })

    // Both on the row and on the wire: *Prijem* reads the answer back to
    // confirm the draft it posted really did flip its scan.
    expect([delivery.source, delivery.scan_id]).toEqual(['scan', draft.scan_id])
    const header = f.db.select().from(schema.deliveries)
      .where(eq(schema.deliveries.id, delivery.id)).get()!
    expect([header.source, header.scanId]).toEqual(['scan', draft.scan_id])

    expect(f.db.select().from(schema.deliveryScans)
      .where(eq(schema.deliveryScans.id, draft.scan_id)).get()!.status).toBe('applied')

    // One `delivery` movement per line — the code that already worked.
    expect(f.db.select().from(schema.stockMovements).all()
      .filter(m => m.type === 'delivery')).toHaveLength(1)
  })

  it('refuses a second Proknjiži on the same scan', async () => {
    const draft = await scan()
    const line = draft.lines.find(l => l.match === 'green')!
    const body = {
      supplier_name: 'Dobavljač', source: 'scan' as const, scan_id: draft.scan_id,
      lines: [{ stock_item_id: line.stock_item_id!, packs: 0, loose: 6, line_cost_fen: 2400 }],
    }

    createDelivery(f.db, f.venueId, f.adminActor(), { ...body, client_id: randomUUID() })
    expectCode(
      () => createDelivery(f.db, f.venueId, f.adminActor(), { ...body, client_id: randomUUID() }),
      'SCAN_ALREADY_APPLIED',
    )
  })

  it('records Odbaci with its reason and refuses it twice', async () => {
    const draft = await scan()
    discardScan(f.db, f.venueId, f.adminActor(), draft.scan_id, {
      reason: 'pogrešna otpremnica',
    }, f.clock.now())

    expect(f.db.select().from(schema.deliveryScans)
      .where(eq(schema.deliveryScans.id, draft.scan_id)).get()!.status).toBe('discarded')
    expect(f.db.select().from(schema.logEntries).all()
      .some(e => e.kind === 'delivery_discarded')).toBe(true)

    expectCode(() => discardScan(f.db, f.venueId, f.adminActor(), draft.scan_id, {
      reason: 'opet',
    }, f.clock.now()), 'ALREADY_DECIDED')
  })
})

describe('a model that answers nothing usable', () => {
  it('is a parsed scan with an error and an empty draft, not an exception', async () => {
    setScanModel({ read: () => Promise.reject(new Error('model refused: cyber')) })
    const draft = await scan()

    expect(draft.status).toBe('parsed')
    expect(draft.lines).toEqual([])
    expect(draft.error).toContain('model refused')
    expect(f.db.select().from(schema.deliveryScans).all()[0]!.error).toContain('model refused')
  })
})

describe('with no model configured at all', () => {
  it('is 503 SCAN_NOT_CONFIGURED, and the typed form still books a delivery', async () => {
    setScanModel(null)
    delete process.env.ANTHROPIC_API_KEY

    await expect(scanDelivery(
      f.db, f.venueId, f.adminActor(), { upload_id: photo() }, f.clock.now(),
    )).rejects.toMatchObject({ status: 503, code: 'SCAN_NOT_CONFIGURED' })

    // The fallback is not a consolation prize — it is the same route the owner
    // has used since Korak 2.
    const delivery = createDelivery(f.db, f.venueId, f.adminActor(), {
      client_id: randomUUID(),
      supplier_name: 'Coca-Cola HBC',
      lines: [{
        stock_item_id: f.stockItemId('Coca-Cola 0,25 l'),
        packs: 1, loose: 0, line_cost_fen: 2400,
      }],
    })
    expect(delivery.id).toBeTruthy()
    expect(f.db.select().from(schema.deliveries)
      .where(eq(schema.deliveries.id, delivery.id)).get()!.source).toBe('manual')
  })
})

describe('delivery_scans, at the database level', () => {
  it('refuses parsed → uploaded and applied → anything', async () => {
    const draft = await scan()
    f.expectRefused(
      `UPDATE delivery_scans SET status = 'uploaded' WHERE id = '${draft.scan_id}'`,
      /illegal transition/,
    )

    f.sqlite.exec(`UPDATE delivery_scans SET status = 'applied' WHERE id = '${draft.scan_id}'`)
    f.expectRefused(
      `UPDATE delivery_scans SET status = 'discarded' WHERE id = '${draft.scan_id}'`,
      /illegal transition/,
    )
    f.expectRefused(`DELETE FROM delivery_scans WHERE id = '${draft.scan_id}'`, /append-only/)
  })

  it('refuses rewriting the model\'s answer after it was parsed', async () => {
    const draft = await scan()
    f.expectRefused(
      `UPDATE delivery_scans SET raw_json = '{}', status = 'applied' WHERE id = '${draft.scan_id}'`,
      /illegal transition/,
    )
  })
})
