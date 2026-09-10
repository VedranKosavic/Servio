/**
 * *Prijem sa slike* — the photo, the wait, and the draft (PHASE4 WP3).
 *
 * The whole network side of the feature lives here so the components can stay
 * about pixels: pick a file → downscale it on the phone → `POST /api/uploads`
 * with `kind='delivery'` → `POST /api/stock/deliveries/scan`, which is the one
 * route in the app that takes **seconds** rather than milliseconds, because a
 * model is reading a photograph.
 *
 * Three states worth naming, because each one draws differently:
 *
 * - `uploading` — bytes are moving; short.
 * - `reading` — "Čitam sliku…"; honest, and never a spinner that pretends to be
 *   instant.
 * - `not-configured` — the venue has no `ANTHROPIC_API_KEY`. That is a
 *   **supported state**, not a fault: the screen draws a calm card and the typed
 *   *Ručno* form underneath, and this composable never retries.
 *
 * Nothing here posts stock. The draft goes back to the screen, the owner edits
 * every line, and *Proknjiži* calls the existing `POST /api/stock/deliveries`
 * with `source: 'scan'` and the `scan_id` — the movements and the moving average
 * are the code that already works.
 */
import { ApiSideError } from '~/composables/useApi'
import type { ScanDraft, ScanDraftLine, ScanMatch, StockItemAdmin } from '#shared/types'

export type ScanStage = 'idle' | 'uploading' | 'reading' | 'draft' | 'not-configured'

/**
 * One draft line while the owner is editing it.
 *
 * The server's `ScanDraftLine` is what the model read; this is what the owner is
 * about to book. They differ in exactly the way the typed form differs from an
 * invoice: `qty` and a price *per pack* become `packs` + `loose` and one
 * `line_cost_fen`, which is what `POST /api/stock/deliveries` takes.
 */
export interface ScanFormLine {
  /** A key for `v-for`; never sent. */
  key: string
  /** The OCR text, verbatim — the alias *Poveži* learns. */
  text: string
  match: ScanMatch
  from_alias: boolean
  confidence: number
  /** `''` until an unknown line gets an article. */
  stock_item_id: string
  packs: number | null
  loose: number | null
  line_cost_fen: number | null
  /** *Preskoči* — the line is read and deliberately not booked. */
  skipped: boolean
  /** What the model read: quantity and price per pack, kept so a re-pick can re-derive. */
  qty: number | null
  unit_price_fen: number | null
}

/**
 * Split the model's quantity into packs and loose the way the item is bought.
 *
 * An item that comes in a gajba of 24 gets "2 gajbe"; one that has no pack size
 * gets 2 loose pieces. The typed form refuses packs on a pack-less item, so the
 * draft must not produce them either.
 */
export function splitQty(qty: number | null, item: StockItemAdmin | undefined): { packs: number, loose: number } {
  const amount = qty ?? 0
  return item?.pack_qty ? { packs: amount, loose: 0 } : { packs: 0, loose: amount }
}

/** `ScanDraftLine` → the row the owner edits. */
export function toFormLine(line: ScanDraftLine, items: StockItemAdmin[]): ScanFormLine {
  const item = items.find(i => i.id === line.stock_item_id)
  const { packs, loose } = splitQty(line.qty, item)
  const qty = line.qty ?? 0
  return {
    key: crypto.randomUUID(),
    text: line.text,
    match: line.match,
    from_alias: line.from_alias,
    confidence: line.confidence,
    stock_item_id: line.stock_item_id ?? '',
    packs: packs || null,
    loose: loose || null,
    // The model reads a price **per pack**; the route takes what the whole line
    // cost. Both are the owner's to correct before he books anything.
    line_cost_fen: line.unit_price_fen !== null && qty > 0
      ? Math.round(line.unit_price_fen * qty)
      : line.unit_price_fen,
    skipped: false,
    qty: line.qty,
    unit_price_fen: line.unit_price_fen,
  }
}

export function useScan() {
  const api = useAdminApi()

  const stage = ref<ScanStage>('idle')
  const draft = ref<ScanDraft | null>(null)
  const error = ref('')
  /** The local preview, shown while the server's copy is still being read. */
  const preview = ref('')

  const busy = computed(() => stage.value === 'uploading' || stage.value === 'reading')

  /** "Čitam sliku…" and its shorter sibling, in one place. */
  const waitText = computed(() => stage.value === 'uploading'
    ? 'Šaljem sliku…'
    : stage.value === 'reading' ? 'Čitam sliku… traje nekoliko sekundi.' : '')

  function clearPreview() {
    if (preview.value) URL.revokeObjectURL(preview.value)
    preview.value = ''
  }

  async function fromFile(file: File): Promise<void> {
    if (busy.value) return
    error.value = ''

    // The phone does the shrinking, before a byte leaves it: 1600 px longest
    // edge at quality 0.85, because the small print on an A4 otpremnica has to
    // survive for the model to read it.
    let blob: Blob
    try {
      // `downscale` hands back the JPEG plus the pixel size it ended up at;
      // this screen shows the photo full-bleed and only needs the bytes.
      blob = (await downscale(file, DELIVERY_IMAGE)).blob
    } catch (err) {
      error.value = err instanceof ImageDecodeError
        ? err.message
        : 'Ovaj format ne radi — slikaj iz aplikacije.'
      return
    }

    clearPreview()
    preview.value = URL.createObjectURL(blob)

    stage.value = 'uploading'
    try {
      const upload = await api.uploadImage(blob, 'delivery')
      stage.value = 'reading'
      draft.value = await api.scanDelivery(upload.id)
      stage.value = 'draft'
    } catch (err) {
      if (err instanceof ApiSideError && err.code === 'SCAN_NOT_CONFIGURED') {
        // Not a failure to report — a venue that has not turned this on. The
        // photo it already uploaded is an orphan the hourly collector unlinks.
        clearPreview()
        stage.value = 'not-configured'
        return
      }
      error.value = apiErrorText(err)
      clearPreview()
      stage.value = 'idle'
    }
  }

  /** *Poveži* — the next photo from this supplier comes back green. */
  async function link(alias: string, stockItemId: string, supplierName?: string): Promise<void> {
    await api.linkSupplierAlias({
      alias,
      stock_item_id: stockItemId,
      ...(supplierName ? { supplier_name: supplierName } : {}),
    })
  }

  /** *Odbaci sken* — with a reason; the hourly GC then unlinks the photo. */
  async function discard(reason: string): Promise<void> {
    const current = draft.value
    if (!current) return
    await api.discardScan(current.scan_id, { reason })
    reset()
  }

  function reset(): void {
    clearPreview()
    draft.value = null
    error.value = ''
    stage.value = 'idle'
  }

  onScopeDispose(clearPreview)

  return { stage, draft, error, preview, busy, waitText, fromFile, link, discard, reset }
}
