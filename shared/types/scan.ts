/**
 * *Prijem sa slike* — a photo of an otpremnica becomes a **draft** (PHASE4 §2.9).
 *
 * Nothing here posts stock. The draft goes back to the phone, the owner edits
 * every line, and *Proknjiži* calls the existing `POST /api/stock/deliveries`
 * with `source: 'scan'` and `scan_id`. Prices from the model are a suggestion
 * the owner edits, exactly like the typed form's `line_cost_fen`.
 */

/** What the prompt tells the model our shelf holds. */
export interface ScanCatalogueLine {
  id: string
  name: string
  brand: string | null
  pack_name: string | null
  pack_qty: number | null
  base_unit: 'kom' | 'g' | 'ml'
}

/** What the prompt tells the model this venue has already learned. */
export interface ScanAliasLine {
  alias: string
  stock_item_id: string
  supplier_name: string | null
}

/** One line as the **model** returned it, before the server checks anything. */
export interface ScanParseLine {
  /** The OCR text of the row, verbatim. */
  text: string
  qty: number | null
  pack: string | null
  unit_price_fen: number | null
  /** A guess. The server looks it up and drops it when it does not exist. */
  stock_item_id: string | null
  confidence: number
}

export interface ScanParse {
  supplier: string | null
  invoice_no: string | null
  date: string | null
  lines: ScanParseLine[]
}

/** Green ≥ 0.8, amber 0.4–0.8, unknown below that or with no real item behind it. */
export type ScanMatch = 'green' | 'amber' | 'unknown'

export interface ScanDraftLine {
  text: string
  qty: number | null
  pack: string | null
  /** What the supplier charged, per pack, as the model read it. Editable. */
  unit_price_fen: number | null
  stock_item_id: string | null
  stock_item_name: string | null
  confidence: number
  match: ScanMatch
  /** True when a `supplier_aliases` row decided this line, not the model. */
  from_alias: boolean
}

export interface ScanDraft {
  scan_id: string
  upload_id: string
  image_url: string
  model: string
  status: 'parsed'
  supplier: string | null
  invoice_no: string | null
  date: string | null
  lines: ScanDraftLine[]
  /** "6 prepoznato · 1 nesigurno · 1 nepoznato" — the header counts. */
  counts: { green: number, amber: number, unknown: number }
  /** The model answered nothing usable: a parsed scan with an empty draft. */
  error: string | null
}
